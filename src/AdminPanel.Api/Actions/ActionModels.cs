using System.Text.Json.Nodes;
using AdminPanel.Api.Tasks;

namespace AdminPanel.Api.Actions;

/// <summary>Definicja typu akcji (plik actions.json).</summary>
public sealed class ActionDefinition
{
    /// <summary>Unikalny klucz akcji (używany w URL /api/actions/{key}/execute).</summary>
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }

    /// <summary>Kolor przycisku w UI (nazwa koloru Mantine: red, blue, orange...).</summary>
    public string? Color { get; set; }

    public string Method { get; set; } = "POST";

    /// <summary>URL docelowy - może zawierać placeholdery, np. https://app/tasks/{{task.id}}/cancel</summary>
    public string Url { get; set; } = "";

    /// <summary>Szablon body JSON. Wartość string równa dokładnie "{{...}}" zostaje zastąpiona wartością z zachowaniem typu.</summary>
    public JsonNode? Body { get; set; }

    /// <summary>Dodatkowe nagłówki (wartości mogą zawierać placeholdery). Nie są wysyłane do przeglądarki.</summary>
    public Dictionary<string, string> Headers { get; set; } = [];

    /// <summary>PassThrough (token zalogowanego użytkownika), ClientCredentials albo None.</summary>
    public ActionAuthMode Auth { get; set; } = ActionAuthMode.PassThrough;

    /// <summary>Liczba równoległych requestów; null = Execution:DefaultParallelism.</summary>
    public int? Parallelism { get; set; }

    public List<ActionParameter> Parameters { get; set; } = [];
}

public enum ActionAuthMode { PassThrough, ClientCredentials, None }

public sealed class ActionParameter
{
    public string Name { get; set; } = "";
    public string Label { get; set; } = "";
    public string? Description { get; set; }

    /// <summary>boolean | text | textarea | number | select</summary>
    public string Type { get; set; } = "text";

    public bool Required { get; set; }
    public JsonNode? Default { get; set; }
    public List<ActionParameterOption> Options { get; set; } = [];
}

public sealed class ActionParameterOption
{
    public string Value { get; set; } = "";
    public string Label { get; set; } = "";
}

/// <summary>Widok akcji dla UI - bez nagłówków (mogą zawierać sekrety).</summary>
public sealed record ActionInfo(
    string Key, string Name, string? Description, string? Color, string Method, string Url,
    JsonNode? Body, ActionAuthMode Auth, int Parallelism, IReadOnlyList<ActionParameter> Parameters);

public sealed record ExecuteActionRequest
{
    public Dictionary<string, JsonNode?> Parameters { get; init; } = [];
    public List<TaskRef> Tasks { get; init; } = [];
}

/// <summary>Wynik pojedynczego requestu.</summary>
public sealed record ExecutionItemResult(
    int Index, string Id, string? WorkflowId, bool Success, int? StatusCode, string? Error, long DurationMs);
