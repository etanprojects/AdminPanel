using System.Text.Json.Nodes;
using AdminPanel.Api.Actions;
using AdminPanel.Api.Tasks;

namespace AdminPanel.Api.Tests;

public class ActionTemplateTests
{
    private static readonly TaskRef Task = new("781c0000-c6ae", "ZAP-40401", "inst-1", "proc-1");

    private static readonly Dictionary<string, JsonNode?> Params = new()
    {
        ["isReject"] = JsonValue.Create(true),
        ["comment"] = JsonValue.Create("Zamknięte"),
        ["count"] = JsonValue.Create(3),
    };

    [Fact]
    public void Whole_placeholder_keeps_parameter_type()
    {
        var body = ActionTemplate.ApplyToJson(
            JsonNode.Parse("""{"id":"{{task.id}}","isReject":"{{param.isReject}}","count":"{{ param.count }}"}"""), Task, Params)!;

        Assert.Equal("781c0000-c6ae", body["id"]!.GetValue<string>());
        Assert.True(body["isReject"]!.GetValue<bool>());
        Assert.Equal(3, body["count"]!.GetValue<int>());
    }

    [Fact]
    public void Placeholder_inside_text_is_interpolated()
    {
        var body = ActionTemplate.ApplyToJson(JsonNode.Parse("""{"comment":"{{param.comment}} ({{task.workflowId}})"}"""), Task, Params)!;
        Assert.Equal("Zamknięte (ZAP-40401)", body["comment"]!.GetValue<string>());
    }

    [Fact]
    public void Nested_objects_and_arrays_are_processed()
    {
        var body = ActionTemplate.ApplyToJson(
            JsonNode.Parse("""{"meta":{"ids":["{{task.instanceId}}","{{task.processId}}"]},"fixed":false}"""), Task, Params)!;

        Assert.Equal("inst-1", body["meta"]!["ids"]![0]!.GetValue<string>());
        Assert.Equal("proc-1", body["meta"]!["ids"]![1]!.GetValue<string>());
        Assert.False(body["fixed"]!.GetValue<bool>());
    }

    [Fact]
    public void Missing_parameter_becomes_null()
    {
        var body = ActionTemplate.ApplyToJson(JsonNode.Parse("""{"x":"{{param.unknown}}"}"""), Task, Params)!;
        Assert.Null(body["x"]);
    }

    [Fact]
    public void Template_is_not_modified()
    {
        var template = JsonNode.Parse("""{"id":"{{task.id}}"}""")!;
        ActionTemplate.ApplyToJson(template, Task, Params);
        Assert.Equal("{{task.id}}", template["id"]!.GetValue<string>());
    }

    [Fact]
    public void Null_template_gives_null_body() =>
        Assert.Null(ActionTemplate.ApplyToJson(null, Task, Params));

    [Fact]
    public void Url_values_are_encoded()
    {
        var task = Task with { Id = "a/b c" };
        var url = ActionTemplate.ApplyToString("https://app/tasks/{{task.id}}/cancel", task, Params, Uri.EscapeDataString);
        Assert.Equal("https://app/tasks/a%2Fb%20c/cancel", url);
    }

    [Fact]
    public void Non_string_values_are_rendered_as_json_in_text() =>
        Assert.Equal("reject=true", ActionTemplate.ApplyToString("reject={{param.isReject}}", Task, Params));

    [Theory]
    [InlineData("{{user.name}}")]
    [InlineData("{{task.unknownField}}")]
    [InlineData("{{nodot}}")]
    public void Unknown_placeholder_throws(string template) =>
        Assert.Throws<InvalidOperationException>(() => ActionTemplate.ApplyToString(template, Task, Params));
}
