using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using AdminPanel.Api.Tasks;

namespace AdminPanel.Api.Actions;

public static partial class ActionTemplate
{
    [GeneratedRegex(@"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")]
    private static partial Regex Placeholder();

    [GeneratedRegex(@"^\s*\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\s*$")]
    private static partial Regex WholePlaceholder();

    public static JsonNode? Resolve(string name, TaskRef task, IReadOnlyDictionary<string, JsonNode?> parameters)
    {
        var parts = name.Split('.', 2);
        if (parts.Length != 2) throw new InvalidOperationException($"Nieznany placeholder: {{{{{name}}}}}");
        return parts[0] switch
        {
            "task" => parts[1].ToLowerInvariant() switch
            {
                "id" => task.Id,
                "workflowid" => task.WorkflowId,
                "instanceid" => task.InstanceId,
                "processid" => task.ProcessId,
                _ => throw new InvalidOperationException($"Nieznane pole zadania: {parts[1]}"),
            },
            "param" => parameters.TryGetValue(parts[1], out var v) ? v?.DeepClone() : null,
            _ => throw new InvalidOperationException($"Nieznany placeholder: {{{{{name}}}}}"),
        };
    }

    public static string ApplyToString(string template, TaskRef task, IReadOnlyDictionary<string, JsonNode?> parameters,
        Func<string, string>? encode = null) =>
        Placeholder().Replace(template, m =>
        {
            var value = Resolve(m.Groups[1].Value, task, parameters);
            var s = value switch
            {
                null => "",
                JsonValue jv when jv.GetValueKind() == JsonValueKind.String => jv.GetValue<string>(),
                _ => value.ToJsonString(),
            };
            return encode is null ? s : encode(s);
        });

    public static JsonNode? ApplyToJson(JsonNode? template, TaskRef task, IReadOnlyDictionary<string, JsonNode?> parameters)
    {
        switch (template)
        {
            case null:
                return null;
            case JsonObject obj:
                var o = new JsonObject();
                foreach (var (k, v) in obj) o[k] = ApplyToJson(v, task, parameters);
                return o;
            case JsonArray arr:
                return new JsonArray(arr.Select(v => ApplyToJson(v, task, parameters)).ToArray());
            case JsonValue val when val.GetValueKind() == JsonValueKind.String:
                var s = val.GetValue<string>();
                var whole = WholePlaceholder().Match(s);
                return whole.Success
                    ? Resolve(whole.Groups[1].Value, task, parameters)
                    : JsonValue.Create(ApplyToString(s, task, parameters));
            default:
                return template.DeepClone();
        }
    }
}
