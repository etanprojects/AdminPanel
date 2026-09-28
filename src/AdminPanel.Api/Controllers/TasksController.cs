using System.Text;
using AdminPanel.Api.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdminPanel.Api.Controllers;

[ApiController]
[Route("api/tasks")]
[Authorize(Policy = AuthPolicies.App)]
public sealed class TasksController(ITaskRepository repo) : ControllerBase
{
    /// <summary>Lista zadań (do 10 000 wyników w jednym żądaniu).</summary>
    [HttpPost("search")]
    public Task<TaskSearchResult> Search([FromBody] TaskSearchRequest request, CancellationToken ct) =>
        repo.SearchAsync(request, ct);

    [HttpPost("count")]
    public async Task<object> Count([FromBody] TaskFilter filter, CancellationToken ct) =>
        new { total = await repo.CountAsync(filter, ct) };

    /// <summary>Słowniki wartości dla filtrów wielokrotnego wyboru.</summary>
    [HttpGet("facets")]
    public Task<FacetsResult> Facets(CancellationToken ct) => repo.FacetsAsync(ct);

    /// <summary>Surowy dokument z indeksu (podgląd szczegółów).</summary>
    [HttpGet("{id}/raw")]
    public async Task<IActionResult> Raw(string id, CancellationToken ct) =>
        await repo.GetRawAsync(id, ct) is { } doc ? Ok(doc) : NotFound();

    /// <summary>Wszystkie zadania spełniające filtr (do limitu MaxBulkResults) - "zaznacz wszystkie wyniki".</summary>
    [HttpPost("refs")]
    public async Task<TaskIdsResult> Refs([FromBody] TaskFilter filter, CancellationToken ct)
    {
        var total = await repo.CountAsync(filter, ct);
        var items = new List<TaskRef>();
        await foreach (var t in repo.ScanAsync(filter, "createdAt", "desc", ct))
            items.Add(new TaskRef(t.Id, t.WorkflowId, t.InstanceId, t.ProcessId));
        return new TaskIdsResult(total, total > items.Count, items);
    }

    /// <summary>Eksport odfiltrowanych zadań do CSV (strumieniowo, separator ';', UTF-8 z BOM).</summary>
    [HttpPost("export")]
    public async Task Export([FromBody] ExportRequest request, CancellationToken ct)
    {
        Response.ContentType = "text/csv; charset=utf-8";
        Response.Headers.ContentDisposition = $"attachment; filename=\"zadania_{DateTime.Now:yyyyMMdd_HHmmss}.csv\"";
        await Response.Body.WriteAsync(Csv.Bom, ct);
        await using var writer = new StreamWriter(Response.Body, new UTF8Encoding(false), 64 * 1024);
        await writer.WriteAsync(Csv.Line("Id zadania", "Data utworzenia", "Data modyfikacji", "Numer zadania",
            "Nazwa procesu", "Krok procesu", "Pobrane przez"));
        await foreach (var t in repo.ScanAsync(request.Filter, request.SortField, request.SortDir, ct))
            await writer.WriteAsync(Csv.Line(t.Id, t.CreatedAt, t.UpdatedAt, t.WorkflowId, t.ProcessName,
                t.CurrentStepName, t.HandledByName));
    }
}

public sealed record ExportRequest(TaskFilter Filter, string? SortField, string? SortDir);
