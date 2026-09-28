using System.Text.Json.Nodes;
using AdminPanel.Api.Tasks;

namespace AdminPanel.Api.Actions;

public sealed class ActionDefinition
{
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }

    public string? Color { get; set; }

    public string Method { get; set; } = "POST";

    public string Url { get; set; } = "";

    public JsonNode? Body { get; set; }

    public Dictionary<string, string> Headers { get; set; } = [];

    public ActionAuthMode Auth { get; set; } = ActionAuthMode.PassThrough;

    public int? Parallelism { get; set; }

    public List<ActionParameter> Parameters { get; set; } = [];
}

public enum ActionAuthMode { PassThrough, ClientCredentials, None }

public sealed class ActionParameter
{
    public string Name { get; set; } = "";
    public string Label { get; set; } = "";
    public string? Description { get; set; }

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

public sealed record ActionInfo(
    string Key, string Name, string? Description, string? Color, string Method, string Url,
    JsonNode? Body, ActionAuthMode Auth, int Parallelism, IReadOnlyList<ActionParameter> Parameters);

public sealed record ExecuteActionRequest
{
    public Dictionary<string, JsonNode?> Parameters { get; init; } = [];
    public List<TaskRef> Tasks { get; init; } = [];
}

public sealed record ExecutionItemResult(
    int Index, string Id, string? WorkflowId, bool Success, int? StatusCode, string? Error, long DurationMs);
