using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Tasks;

/// <summary>
/// Dostęp do indeksu zadań przez REST API Elasticsearcha (działa z ES 7.10+ i 8.x).
/// Zapytania budowane ręcznie, żeby nie wiązać się z wersją klienta.
/// </summary>
public sealed class ElasticTaskRepository(HttpClient http, IOptions<ElasticsearchOptions> options, ILogger<ElasticTaskRepository> log)
    : ITaskRepository
{
    private readonly ElasticsearchOptions _opt = options.Value;

    private static readonly HashSet<string> SortableFields =
        ["id", "createdAt", "updatedAt", "workflowId", "processName", "currentStepName", "handledByName"];

    private const int ScanBatchSize = 1000;

    public static void ConfigureClient(HttpClient http, ElasticsearchOptions opt)
    {
        http.BaseAddress = new Uri(opt.Url.TrimEnd('/') + "/");
        http.Timeout = TimeSpan.FromSeconds(60);
        if (!string.IsNullOrEmpty(opt.ApiKey))
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("ApiKey", opt.ApiKey);
        else if (!string.IsNullOrEmpty(opt.Username))
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes($"{opt.Username}:{opt.Password}")));
    }

    public async Task<TaskSearchResult> SearchAsync(TaskSearchRequest request, CancellationToken ct)
    {
        var pageSize = Math.Clamp(request.PageSize, 1, 10000);
        var page = Math.Max(1, request.Page);
        var from = (page - 1) * pageSize;
        if (from + pageSize > 10000)
            throw new BadRequestException("Lista obsługuje maksymalnie 10 000 pierwszych wyników - zawęź filtry.");

        var body = new JsonObject
        {
            ["from"] = from,
            ["size"] = pageSize,
            ["track_total_hits"] = true,
            ["query"] = BuildQuery(request.Filter),
            ["sort"] = BuildSort(request.SortField, request.SortDir),
            ["_source"] = SourceFields(),
        };

        using var doc = await PostAsync($"{_opt.Index}/_search", body, ct);
        var hits = doc.RootElement.GetProperty("hits");
        return new TaskSearchResult(ReadTotal(hits), ReadHits(hits).ToList());
    }

    public async IAsyncEnumerable<TaskDto> ScanAsync(TaskFilter filter, string? sortField, string? sortDir,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var query = BuildQuery(filter);
        JsonNode? searchAfter = null;
        var returned = 0;

        while (returned < _opt.MaxBulkResults)
        {
            var body = new JsonObject
            {
                ["size"] = Math.Min(ScanBatchSize, _opt.MaxBulkResults - returned),
                ["track_total_hits"] = false,
                ["query"] = query.DeepClone(),
                ["sort"] = BuildSort(sortField, sortDir),
                ["_source"] = SourceFields(),
            };
            if (searchAfter is not null) body["search_after"] = searchAfter.DeepClone();

            using var doc = await PostAsync($"{_opt.Index}/_search", body, ct);
            var hitsArr = doc.RootElement.GetProperty("hits").GetProperty("hits");
            if (hitsArr.GetArrayLength() == 0) yield break;

            foreach (var hit in hitsArr.EnumerateArray())
            {
                yield return ToDto(hit);
                returned++;
                searchAfter = JsonNode.Parse(hit.GetProperty("sort").GetRawText());
            }
            if (hitsArr.GetArrayLength() < ScanBatchSize) yield break;
        }
    }

    public async Task<long> CountAsync(TaskFilter filter, CancellationToken ct)
    {
        using var doc = await PostAsync($"{_opt.Index}/_count", new JsonObject { ["query"] = BuildQuery(filter) }, ct);
        return doc.RootElement.GetProperty("count").GetInt64();
    }

    public async Task<FacetsResult> FacetsAsync(CancellationToken ct)
    {
        JsonObject Terms(string field) => new()
        {
            ["terms"] = new JsonObject { ["field"] = _opt.Field(field), ["size"] = _opt.FacetSize, ["order"] = new JsonObject { ["_key"] = "asc" } },
        };

        var body = new JsonObject
        {
            ["size"] = 0,
            ["aggs"] = new JsonObject
            {
                ["processName"] = Terms("processName"),
                ["currentStepName"] = Terms("currentStepName"),
                ["handledByName"] = Terms("handledByName"),
            },
        };

        using var doc = await PostAsync($"{_opt.Index}/_search", body, ct);
        var aggs = doc.RootElement.GetProperty("aggregations");
        List<FacetValue> Read(string name) => aggs.GetProperty(name).GetProperty("buckets").EnumerateArray()
            .Select(b => new FacetValue(b.GetProperty("key").GetString() ?? "", b.GetProperty("doc_count").GetInt64()))
            .ToList();

        return new FacetsResult(Read("processName"), Read("currentStepName"), Read("handledByName"));
    }

    public async Task<JsonElement?> GetRawAsync(string id, CancellationToken ct)
    {
        var body = new JsonObject
        {
            ["size"] = 1,
            ["query"] = new JsonObject
            {
                ["bool"] = new JsonObject
                {
                    ["should"] = new JsonArray(
                        new JsonObject { ["ids"] = new JsonObject { ["values"] = new JsonArray(id) } },
                        new JsonObject { ["term"] = new JsonObject { [_opt.Field("id")] = id } }),
                },
            },
        };
        using var doc = await PostAsync($"{_opt.Index}/_search", body, ct);
        var hits = doc.RootElement.GetProperty("hits").GetProperty("hits");
        return hits.GetArrayLength() == 0 ? null : hits[0].GetProperty("_source").Clone();
    }

    // ---------------------------------------------------------------- query building

    internal JsonObject BuildQuery(TaskFilter f)
    {
        var must = new JsonArray();
        var filter = new JsonArray();
        var mustNot = new JsonArray();

        if (!string.IsNullOrWhiteSpace(f.Query))
        {
            must.Add(new JsonObject
            {
                ["query_string"] = new JsonObject
                {
                    ["query"] = f.Query.Trim(),
                    ["default_operator"] = "AND",
                    ["lenient"] = true,
                },
            });
        }

        AddContains(filter, "id", f.Id);
        AddContains(filter, "workflowId", f.WorkflowId);
        AddTerms(filter, "id", f.Ids);
        AddTerms(filter, "processName", f.ProcessNames);
        AddTerms(filter, "currentStepName", f.StepNames);
        AddTerms(filter, "handledByName", f.HandledByNames);
        AddRange(filter, "createdAt", f.CreatedFrom, f.CreatedTo);
        AddRange(filter, "updatedAt", f.UpdatedFrom, f.UpdatedTo);

        if (f.NotHandled == true)
            mustNot.Add(new JsonObject { ["exists"] = new JsonObject { ["field"] = _opt.Field("handledByName") } });

        if (must.Count == 0 && filter.Count == 0 && mustNot.Count == 0)
            return new JsonObject { ["match_all"] = new JsonObject() };

        return new JsonObject
        {
            ["bool"] = new JsonObject { ["must"] = must, ["filter"] = filter, ["must_not"] = mustNot },
        };
    }

    private void AddContains(JsonArray target, string field, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        var escaped = value.Trim().Replace("\\", "\\\\").Replace("*", "\\*").Replace("?", "\\?");
        target.Add(new JsonObject
        {
            ["wildcard"] = new JsonObject
            {
                [_opt.Field(field)] = new JsonObject { ["value"] = $"*{escaped}*", ["case_insensitive"] = true },
            },
        });
    }

    private void AddTerms(JsonArray target, string field, string[]? values)
    {
        if (values is not { Length: > 0 }) return;
        target.Add(new JsonObject
        {
            ["terms"] = new JsonObject { [_opt.Field(field)] = new JsonArray(values.Select(v => (JsonNode?)v).ToArray()) },
        });
    }

    private void AddRange(JsonArray target, string field, string? from, string? to)
    {
        if (string.IsNullOrWhiteSpace(from) && string.IsNullOrWhiteSpace(to)) return;
        var range = new JsonObject { ["time_zone"] = _opt.TimeZone };
        if (!string.IsNullOrWhiteSpace(from)) range["gte"] = from;
        if (!string.IsNullOrWhiteSpace(to)) range["lte"] = to;
        target.Add(new JsonObject { ["range"] = new JsonObject { [_opt.Field(field)] = range } });
    }

    private JsonArray BuildSort(string? sortField, string? sortDir)
    {
        var field = sortField is not null && SortableFields.Contains(sortField) ? sortField : "createdAt";
        var dir = string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase) ? "asc" : "desc";
        var sort = new JsonArray(new JsonObject
        {
            [_opt.Field(field)] = new JsonObject { ["order"] = dir, ["missing"] = "_last", ["unmapped_type"] = "keyword" },
        });
        // tie-breaker - wymagany dla stabilnego search_after
        if (field != "id")
            sort.Add(new JsonObject { [_opt.Field("id")] = new JsonObject { ["order"] = "asc", ["unmapped_type"] = "keyword" } });
        return sort;
    }

    private static JsonArray SourceFields() => new(
        "id", "instanceId", "processId", "createdAt", "updatedAt", "workflowId", "processName",
        "currentStepName", "handledBy", "handledByName", "state", "status");

    // ---------------------------------------------------------------- transport

    private async Task<JsonDocument> PostAsync(string path, JsonObject body, CancellationToken ct)
    {
        using var content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var resp = await http.PostAsync(path, content, ct);
        var text = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
        {
            log.LogWarning("Elasticsearch {Status} for {Path}: {Body}\nQuery: {Query}", (int)resp.StatusCode, path, text, body.ToJsonString());
            if ((int)resp.StatusCode == 400)
                throw new BadRequestException("Elasticsearch odrzucił zapytanie (sprawdź składnię query string): " + ExtractReason(text));
            throw new InvalidOperationException($"Elasticsearch zwrócił {(int)resp.StatusCode}: {ExtractReason(text)}");
        }
        return JsonDocument.Parse(text);
    }

    private static string ExtractReason(string text)
    {
        try
        {
            using var d = JsonDocument.Parse(text);
            var err = d.RootElement.GetProperty("error");
            if (err.TryGetProperty("root_cause", out var rc) && rc.GetArrayLength() > 0 && rc[0].TryGetProperty("reason", out var r))
                return r.GetString() ?? text;
            if (err.TryGetProperty("reason", out var reason)) return reason.GetString() ?? text;
        }
        catch { /* nie-JSON */ }
        return text.Length > 500 ? text[..500] : text;
    }

    private static long ReadTotal(JsonElement hits)
    {
        var total = hits.GetProperty("total");
        return total.ValueKind == JsonValueKind.Number ? total.GetInt64() : total.GetProperty("value").GetInt64();
    }

    private static IEnumerable<TaskDto> ReadHits(JsonElement hits) =>
        hits.GetProperty("hits").EnumerateArray().Select(ToDto);

    private static TaskDto ToDto(JsonElement hit) =>
        TaskDto.FromSource(hit.GetProperty("_id").GetString()!, hit.GetProperty("_source"));
}

public sealed class BadRequestException(string message) : Exception(message);
