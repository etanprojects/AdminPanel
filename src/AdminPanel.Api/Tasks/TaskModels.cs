using System.Text.Json;

namespace AdminPanel.Api.Tasks;

public sealed record TaskFilter
{
    public string? Query { get; init; }

    public string? Id { get; init; }

    public string? WorkflowId { get; init; }

    public string[]? Ids { get; init; }

    public string[]? ProcessNames { get; init; }
    public string[]? StepNames { get; init; }
    public string[]? HandledByNames { get; init; }

    public bool? NotHandled { get; init; }

    public string? CreatedFrom { get; init; }
    public string? CreatedTo { get; init; }
    public string? UpdatedFrom { get; init; }
    public string? UpdatedTo { get; init; }
}

public sealed record TaskSearchRequest
{
    public TaskFilter Filter { get; init; } = new();
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 50;
    public string? SortField { get; init; } = "createdAt";
    public string? SortDir { get; init; } = "desc";
}

public sealed record TaskDto
{
    public required string Id { get; init; }
    public string? InstanceId { get; init; }
    public string? ProcessId { get; init; }
    public string? CreatedAt { get; init; }
    public string? UpdatedAt { get; init; }
    public string? WorkflowId { get; init; }
    public string? ProcessName { get; init; }
    public string? CurrentStepName { get; init; }
    public string? HandledBy { get; init; }
    public string? HandledByName { get; init; }
    public int? State { get; init; }
    public int? Status { get; init; }

    public static TaskDto FromSource(string docId, JsonElement src) => new()
    {
        Id = Str(src, "id") ?? docId,
        InstanceId = Str(src, "instanceId"),
        ProcessId = Str(src, "processId"),
        CreatedAt = Str(src, "createdAt"),
        UpdatedAt = Str(src, "updatedAt"),
        WorkflowId = Str(src, "workflowId"),
        ProcessName = Str(src, "processName"),
        CurrentStepName = Str(src, "currentStepName"),
        HandledBy = Str(src, "handledBy"),
        HandledByName = Str(src, "handledByName"),
        State = Int(src, "state"),
        Status = Int(src, "status"),
    };

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null
            ? (v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText())
            : null;

    private static int? Int(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : null;
}

public sealed record TaskRef(string Id, string? WorkflowId, string? InstanceId, string? ProcessId);

public sealed record TaskSearchResult(long Total, IReadOnlyList<TaskDto> Items);

public sealed record TaskIdsResult(long Total, bool Truncated, IReadOnlyList<TaskRef> Items);

public sealed record FacetsResult(
    IReadOnlyList<FacetValue> ProcessNames,
    IReadOnlyList<FacetValue> StepNames,
    IReadOnlyList<FacetValue> HandledByNames);

public sealed record FacetValue(string Value, long Count);

public interface ITaskRepository
{
    Task<TaskSearchResult> SearchAsync(TaskSearchRequest request, CancellationToken ct);

    IAsyncEnumerable<TaskDto> ScanAsync(TaskFilter filter, string? sortField, string? sortDir, CancellationToken ct);

    Task<long> CountAsync(TaskFilter filter, CancellationToken ct);

    Task<FacetsResult> FacetsAsync(CancellationToken ct);

    Task<JsonElement?> GetRawAsync(string id, CancellationToken ct);
}
