using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Tasks;

public sealed class SampleTaskRepository(IOptions<ElasticsearchOptions> options) : ITaskRepository
{
    private static readonly Lazy<List<TaskDto>> Data = new(Generate);
    private readonly ElasticsearchOptions _opt = options.Value;

    public Task<TaskSearchResult> SearchAsync(TaskSearchRequest request, CancellationToken ct)
    {
        var all = Filtered(request.Filter, request.SortField, request.SortDir).ToList();
        var pageSize = Math.Clamp(request.PageSize, 1, 10000);
        var items = all.Skip((Math.Max(1, request.Page) - 1) * pageSize).Take(pageSize).ToList();
        return Task.FromResult(new TaskSearchResult(all.Count, items));
    }

    public async IAsyncEnumerable<TaskDto> ScanAsync(TaskFilter filter, string? sortField, string? sortDir,
        [EnumeratorCancellation] CancellationToken ct)
    {
        foreach (var t in Filtered(filter, sortField, sortDir).Take(_opt.MaxBulkResults))
        {
            ct.ThrowIfCancellationRequested();
            yield return t;
        }
        await Task.CompletedTask;
    }

    public Task<long> CountAsync(TaskFilter filter, CancellationToken ct) =>
        Task.FromResult((long)Filtered(filter, null, null).Count());

    public Task<FacetsResult> FacetsAsync(CancellationToken ct)
    {
        List<FacetValue> Facet(Func<TaskDto, string?> sel) => Data.Value
            .Select(sel).Where(v => v is not null)
            .GroupBy(v => v!).OrderBy(g => g.Key)
            .Select(g => new FacetValue(g.Key, g.Count())).ToList();

        return Task.FromResult(new FacetsResult(Facet(t => t.ProcessName), Facet(t => t.CurrentStepName), Facet(t => t.HandledByName)));
    }

    public Task<JsonElement?> GetRawAsync(string id, CancellationToken ct)
    {
        var t = Data.Value.FirstOrDefault(x => x.Id == id);
        return Task.FromResult<JsonElement?>(t is null ? null : JsonSerializer.SerializeToElement(t, JsonSerializerOptions.Web));
    }

    private static IEnumerable<TaskDto> Filtered(TaskFilter f, string? sortField, string? sortDir)
    {
        IEnumerable<TaskDto> q = Data.Value;

        if (!string.IsNullOrWhiteSpace(f.Query) && f.Query.Trim() != "*")
        {
            var terms = f.Query.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim('"'));
            q = q.Where(t => terms.All(term =>
                new[] { t.Id, t.WorkflowId, t.ProcessName, t.CurrentStepName, t.HandledByName, t.HandledBy }
                    .Any(v => v?.Contains(term, StringComparison.OrdinalIgnoreCase) == true)));
        }
        if (!string.IsNullOrWhiteSpace(f.Id)) q = q.Where(t => t.Id.Contains(f.Id.Trim(), StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(f.WorkflowId)) q = q.Where(t => t.WorkflowId?.Contains(f.WorkflowId.Trim(), StringComparison.OrdinalIgnoreCase) == true);
        if (f.Ids is { Length: > 0 }) q = q.Where(t => f.Ids.Contains(t.Id));
        if (f.ProcessNames is { Length: > 0 }) q = q.Where(t => f.ProcessNames.Contains(t.ProcessName));
        if (f.StepNames is { Length: > 0 }) q = q.Where(t => f.StepNames.Contains(t.CurrentStepName));
        if (f.HandledByNames is { Length: > 0 }) q = q.Where(t => f.HandledByNames.Contains(t.HandledByName));
        if (f.NotHandled == true) q = q.Where(t => t.HandledByName is null);
        q = InRange(q, t => t.CreatedAt, f.CreatedFrom, f.CreatedTo);
        q = InRange(q, t => t.UpdatedAt, f.UpdatedFrom, f.UpdatedTo);

        Func<TaskDto, string?> key = sortField switch
        {
            "id" => t => t.Id,
            "updatedAt" => t => t.UpdatedAt,
            "workflowId" => t => t.WorkflowId,
            "processName" => t => t.ProcessName,
            "currentStepName" => t => t.CurrentStepName,
            "handledByName" => t => t.HandledByName,
            _ => t => t.CreatedAt,
        };
        return string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase)
            ? q.OrderBy(key, StringComparer.Ordinal).ThenBy(t => t.Id)
            : q.OrderByDescending(key, StringComparer.Ordinal).ThenBy(t => t.Id);
    }

    private static IEnumerable<TaskDto> InRange(IEnumerable<TaskDto> q, Func<TaskDto, string?> sel, string? from, string? to)
    {
        if (DateTime.TryParse(from, CultureInfo.InvariantCulture, DateTimeStyles.None, out var f))
            q = q.Where(t => DateTime.TryParse(sel(t), CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) && d >= f);
        if (DateTime.TryParse(to, CultureInfo.InvariantCulture, DateTimeStyles.None, out var tt))
            q = q.Where(t => DateTime.TryParse(sel(t), CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) && d <= tt);
        return q;
    }

    private static List<TaskDto> Generate()
    {
        var rnd = new Random(42);
        string[] processes = ["Zapytanie z Departamentu Prawnego do CBO", "Reklamacja klienta", "Wniosek o zaświadczenie", "Zajęcie komornicze"];
        string[] steps = ["Weryfikacja w DPR - pozew bierny", "Rejestracja", "Weryfikacja formalna", "Akceptacja", "Przygotowanie odpowiedzi"];
        (string Id, string Name)?[] handlers = [("PZ007385", "Rosłon Michał (EXT)"), ("R1501542", "Kowalska Anna"), ("R1500258", "Nowak Piotr"), null, null];
        var start = new DateTime(2025, 6, 1, 8, 0, 0);

        return Enumerable.Range(0, 12000).Select(i =>
        {
            var created = start.AddMinutes(rnd.Next(0, 60 * 24 * 150));
            var updated = created.AddMinutes(rnd.Next(1, 60 * 24 * 20));
            var h = handlers[rnd.Next(handlers.Length)];
            var id = Guid.CreateVersion7(new DateTimeOffset(created, TimeSpan.Zero)).ToString();
            return new TaskDto
            {
                Id = id,
                InstanceId = id,
                ProcessId = Guid.NewGuid().ToString(),
                CreatedAt = created.ToString("yyyy-MM-ddTHH:mm:ss.fffffff", CultureInfo.InvariantCulture),
                UpdatedAt = updated.ToString("yyyy-MM-ddTHH:mm:ss.fffffff", CultureInfo.InvariantCulture) + "+02:00",
                WorkflowId = $"ZAP-{40000 + i}",
                ProcessName = processes[rnd.Next(processes.Length)],
                CurrentStepName = steps[rnd.Next(steps.Length)],
                HandledBy = h?.Id,
                HandledByName = h?.Name,
                State = 2001,
                Status = 0,
            };
        }).ToList();
    }
}
