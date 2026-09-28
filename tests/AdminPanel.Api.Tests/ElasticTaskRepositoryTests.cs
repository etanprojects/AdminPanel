using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using AdminPanel.Api.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Tests;

public class ElasticTaskRepositoryTests
{
    private static readonly ElasticsearchOptions Options = new() { Url = "http://es:9200", Index = "basic_basetask", TimeZone = "Europe/Warsaw" };

    private static (ElasticTaskRepository Repo, FakeHttpHandler Handler) Create(Func<RecordedRequest, HttpResponseMessage> respond, ElasticsearchOptions? options = null)
    {
        var opt = options ?? Options;
        var handler = new FakeHttpHandler(respond);
        var http = new HttpClient(handler);
        ElasticTaskRepository.ConfigureClient(http, opt);
        return (new ElasticTaskRepository(http, Microsoft.Extensions.Options.Options.Create(opt), NullLogger<ElasticTaskRepository>.Instance), handler);
    }

    private static ElasticTaskRepository Repo() => Create(_ => throw new InvalidOperationException()).Repo;

    private static JsonArray Filters(JsonObject query) => query["bool"]!["filter"]!.AsArray();

    private static string HitsJson(int count, int start = 0, long? total = null) =>
        JsonSerializer.Serialize(new
        {
            hits = new
            {
                total = new { value = total ?? count, relation = "eq" },
                hits = Enumerable.Range(start, count).Select(i => new
                {
                    _id = $"doc-{i}",
                    _source = new { id = $"task-{i}", workflowId = $"ZAP-{i}", createdAt = "2025-10-03T12:59:40.7566670", state = 2001 },
                    sort = new object[] { 1000 - i, $"task-{i}" },
                }),
            },
        });

    [Fact]
    public void Empty_filter_is_match_all()
    {
        var query = Repo().BuildQuery(new TaskFilter());
        Assert.NotNull(query["match_all"]);
    }

    [Fact]
    public void Query_string_uses_and_operator_and_is_lenient()
    {
        var query = Repo().BuildQuery(new TaskFilter { Query = "  state:2001 ZAP  " });
        var qs = query["bool"]!["must"]![0]!["query_string"]!;
        Assert.Equal("state:2001 ZAP", qs["query"]!.GetValue<string>());
        Assert.Equal("AND", qs["default_operator"]!.GetValue<string>());
        Assert.True(qs["lenient"]!.GetValue<bool>());
    }

    [Fact]
    public void Text_filters_use_case_insensitive_contains_with_escaped_wildcards()
    {
        var query = Repo().BuildQuery(new TaskFilter { WorkflowId = " zap*1? " });
        var wildcard = Filters(query)[0]!["wildcard"]!["workflowId.keyword"]!;
        Assert.Equal("*zap\\*1\\?*", wildcard["value"]!.GetValue<string>());
        Assert.True(wildcard["case_insensitive"]!.GetValue<bool>());
    }

    [Fact]
    public void Only_from_date_produces_gte_range()
    {
        var query = Repo().BuildQuery(new TaskFilter { CreatedFrom = "2025-10-01T00:00:00" });
        var range = Filters(query)[0]!["range"]!["createdAt"]!.AsObject();
        Assert.Equal("2025-10-01T00:00:00", range["gte"]!.GetValue<string>());
        Assert.False(range.ContainsKey("lte"));
        Assert.Equal("Europe/Warsaw", range["time_zone"]!.GetValue<string>());
    }

    [Fact]
    public void Only_to_date_produces_lte_range()
    {
        var query = Repo().BuildQuery(new TaskFilter { UpdatedTo = "2025-10-31T23:59:59" });
        var range = Filters(query)[0]!["range"]!["updatedAt"]!.AsObject();
        Assert.Equal("2025-10-31T23:59:59", range["lte"]!.GetValue<string>());
        Assert.False(range.ContainsKey("gte"));
    }

    [Fact]
    public void Both_dates_produce_single_range()
    {
        var query = Repo().BuildQuery(new TaskFilter { CreatedFrom = "2025-10-01T00:00:00", CreatedTo = "2025-10-31T23:59:59" });
        var filters = Filters(query);
        Assert.Single(filters);
        var range = filters[0]!["range"]!["createdAt"]!;
        Assert.NotNull(range["gte"]);
        Assert.NotNull(range["lte"]);
    }

    [Fact]
    public void Multi_select_filters_use_terms_on_keyword_fields()
    {
        var query = Repo().BuildQuery(new TaskFilter { ProcessNames = ["A", "B"], StepNames = ["S"], HandledByNames = ["H"], Ids = ["1"] });
        var fields = Filters(query).Select(f => f!["terms"]!.AsObject().Single().Key).ToList();
        Assert.Equal(["id.keyword", "processName.keyword", "currentStepName.keyword", "handledByName.keyword"], fields);
    }

    [Fact]
    public void Not_handled_excludes_documents_with_handler()
    {
        var query = Repo().BuildQuery(new TaskFilter { NotHandled = true });
        Assert.Equal("handledByName.keyword", query["bool"]!["must_not"]![0]!["exists"]!["field"]!.GetValue<string>());
    }

    [Fact]
    public void Field_mapping_is_configurable()
    {
        var options = new ElasticsearchOptions { Fields = new() { ["workflowId"] = "wf" } };
        var repo = Create(_ => throw new InvalidOperationException(), options).Repo;
        var query = repo.BuildQuery(new TaskFilter { WorkflowId = "1" });
        Assert.NotNull(Filters(query)[0]!["wildcard"]!["wf"]);
    }

    [Fact]
    public async Task Search_posts_to_index_and_maps_hits()
    {
        var (repo, handler) = Create(_ => FakeHttpHandler.Json(HitsJson(2, total: 12000)));
        var result = await repo.SearchAsync(new TaskSearchRequest { Page = 2, PageSize = 50, SortField = "workflowId", SortDir = "asc", Filter = new() { Query = "x" } }, default);

        Assert.Equal(12000, result.Total);
        Assert.Equal(["task-0", "task-1"], result.Items.Select(i => i.Id));
        Assert.Equal(2001, result.Items[0].State);

        var request = Assert.Single(handler.Requests);
        Assert.Equal("http://es:9200/basic_basetask/_search", request.Uri.ToString());
        var body = JsonNode.Parse(request.Body!)!;
        Assert.Equal(50, body["from"]!.GetValue<int>());
        Assert.Equal(50, body["size"]!.GetValue<int>());
        Assert.True(body["track_total_hits"]!.GetValue<bool>());
        Assert.Equal("asc", body["sort"]![0]!["workflowId.keyword"]!["order"]!.GetValue<string>());
        Assert.NotNull(body["sort"]![1]!["id.keyword"]);
    }

    [Fact]
    public async Task Search_falls_back_to_document_id_when_source_has_no_id()
    {
        var json = """{"hits":{"total":1,"hits":[{"_id":"doc-1","_source":{"workflowId":"ZAP-1"}}]}}""";
        var (repo, _) = Create(_ => FakeHttpHandler.Json(json));
        var result = await repo.SearchAsync(new TaskSearchRequest(), default);
        Assert.Equal(1, result.Total);
        Assert.Equal("doc-1", result.Items[0].Id);
    }

    [Fact]
    public async Task Unknown_sort_field_falls_back_to_created_at()
    {
        var (repo, handler) = Create(_ => FakeHttpHandler.Json(HitsJson(0)));
        await repo.SearchAsync(new TaskSearchRequest { SortField = "script", SortDir = "sideways" }, default);
        var sort = JsonNode.Parse(handler.Requests.Single().Body!)!["sort"]![0]!["createdAt"]!;
        Assert.Equal("desc", sort["order"]!.GetValue<string>());
    }

    [Fact]
    public async Task Search_beyond_result_window_is_rejected()
    {
        var (repo, handler) = Create(_ => FakeHttpHandler.Json(HitsJson(0)));
        await Assert.ThrowsAsync<BadRequestException>(() => repo.SearchAsync(new TaskSearchRequest { Page = 3, PageSize = 5000 }, default));
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Invalid_query_returns_readable_bad_request()
    {
        var error = """{"error":{"root_cause":[{"type":"query_shard_exception","reason":"Failed to parse query [a AND]"}],"reason":"all shards failed"},"status":400}""";
        var (repo, _) = Create(_ => FakeHttpHandler.Json(error, HttpStatusCode.BadRequest));
        var ex = await Assert.ThrowsAsync<BadRequestException>(() => repo.SearchAsync(new TaskSearchRequest { Filter = new() { Query = "a AND" } }, default));
        Assert.Contains("Failed to parse query [a AND]", ex.Message);
    }

    [Fact]
    public async Task Server_error_is_reported()
    {
        var (repo, _) = Create(_ => FakeHttpHandler.Text("cluster unavailable", HttpStatusCode.ServiceUnavailable));
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => repo.SearchAsync(new TaskSearchRequest(), default));
        Assert.Contains("503", ex.Message);
    }

    [Fact]
    public async Task Scan_pages_with_search_after_until_last_batch()
    {
        var calls = 0;
        var (repo, handler) = Create(_ => FakeHttpHandler.Json(++calls == 1 ? HitsJson(1000) : HitsJson(3, start: 1000)));

        var items = new List<TaskDto>();
        await foreach (var t in repo.ScanAsync(new TaskFilter(), "createdAt", "desc", default)) items.Add(t);

        Assert.Equal(1003, items.Count);
        var requests = handler.Requests.ToArray();
        Assert.Equal(2, requests.Length);
        Assert.Null(JsonNode.Parse(requests[0].Body!)!["search_after"]);
        var searchAfter = JsonNode.Parse(requests[1].Body!)!["search_after"]!.AsArray();
        Assert.Equal("task-999", searchAfter[1]!.GetValue<string>());
    }

    [Fact]
    public async Task Scan_respects_max_bulk_results()
    {
        var options = new ElasticsearchOptions { Url = "http://es:9200", MaxBulkResults = 10 };
        var (repo, handler) = Create(_ => FakeHttpHandler.Json(HitsJson(10)), options);

        var count = 0;
        await foreach (var _ in repo.ScanAsync(new TaskFilter(), null, null, default)) count++;

        Assert.Equal(10, count);
        Assert.Equal(10, JsonNode.Parse(handler.Requests.Single().Body!)!["size"]!.GetValue<int>());
    }

    [Fact]
    public async Task Count_uses_count_endpoint()
    {
        var (repo, handler) = Create(_ => FakeHttpHandler.Json("""{"count":42}"""));
        Assert.Equal(42, await repo.CountAsync(new TaskFilter { Query = "x" }, default));
        Assert.EndsWith("/basic_basetask/_count", handler.Requests.Single().Uri.AbsolutePath);
    }

    [Fact]
    public async Task Facets_read_terms_aggregations()
    {
        var json = """
            {"aggregations":{
              "processName":{"buckets":[{"key":"Reklamacja","doc_count":5}]},
              "currentStepName":{"buckets":[]},
              "handledByName":{"buckets":[{"key":"Nowak Piotr","doc_count":2},{"key":"Kowalska Anna","doc_count":1}]}}}
            """;
        var (repo, _) = Create(_ => FakeHttpHandler.Json(json));
        var facets = await repo.FacetsAsync(default);

        Assert.Equal(new FacetValue("Reklamacja", 5), Assert.Single(facets.ProcessNames));
        Assert.Empty(facets.StepNames);
        Assert.Equal(2, facets.HandledByNames.Count);
    }

    [Fact]
    public void Client_uses_api_key_when_configured()
    {
        var http = new HttpClient();
        ElasticTaskRepository.ConfigureClient(http, new ElasticsearchOptions { Url = "http://es:9200", ApiKey = "abc" });
        Assert.Equal("ApiKey abc", http.DefaultRequestHeaders.Authorization!.ToString());
        Assert.Equal("http://es:9200/", http.BaseAddress!.ToString());
    }

    [Fact]
    public void Client_uses_basic_auth_when_configured()
    {
        var http = new HttpClient();
        ElasticTaskRepository.ConfigureClient(http, new ElasticsearchOptions { Url = "http://es:9200/", Username = "u", Password = "p" });
        Assert.Equal("Basic dTpw", http.DefaultRequestHeaders.Authorization!.ToString());
    }
}
