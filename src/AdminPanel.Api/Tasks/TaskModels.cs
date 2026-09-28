using System.Text.Json;

namespace AdminPanel.Api.Tasks;

/// <summary>Filtry listy zadań. Wszystkie warunki łączone są przez AND.</summary>
public sealed record TaskFilter
{
    /// <summary>Składnia query_string Elasticsearcha, np. <c>keywords:"XXVIII C 11648/21" AND state:2001</c>.</summary>
    public string? Query { get; init; }

    /// <summary>Fragment Id zadania (contains, bez rozróżniania wielkości liter).</summary>
    public string? Id { get; init; }

    /// <summary>Fragment numeru zadania (workflowId).</summary>
    public string? WorkflowId { get; init; }

    /// <summary>Dokładne Id zadań (np. eksport tylko zaznaczonych).</summary>
    public string[]? Ids { get; init; }

    public string[]? ProcessNames { get; init; }
    public string[]? StepNames { get; init; }
    public string[]? HandledByNames { get; init; }

    /// <summary>true = tylko zadania niepobrane przez nikogo (brak handledByName).</summary>
    public bool? NotHandled { get; init; }

    /// <summary>Daty w formacie yyyy-MM-ddTHH:mm:ss (bez strefy - interpretowane w Elasticsearch:TimeZone).</summary>
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

/// <summary>Minimalny zestaw danych zadania potrzebny do wywołania akcji.</summary>
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

    /// <summary>Wszystkie zadania spełniające filtr (do limitu MaxBulkResults), strumieniowo.</summary>
    IAsyncEnumerable<TaskDto> ScanAsync(TaskFilter filter, string? sortField, string? sortDir, CancellationToken ct);

    Task<long> CountAsync(TaskFilter filter, CancellationToken ct);

    Task<FacetsResult> FacetsAsync(CancellationToken ct);

    /// <summary>Surowy dokument (_source) do podglądu.</summary>
    Task<JsonElement?> GetRawAsync(string id, CancellationToken ct);
}
