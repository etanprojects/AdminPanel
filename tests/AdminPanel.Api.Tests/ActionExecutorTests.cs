using System.Net;
using System.Text.Json.Nodes;
using AdminPanel.Api.Actions;
using AdminPanel.Api.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Tests;

public class ActionExecutorTests
{
    private static ActionDefinition FinishAction(ActionAuthMode auth = ActionAuthMode.PassThrough) => new()
    {
        Key = "finish-as-administrator",
        Name = "Zakończ jako administrator",
        Method = "POST",
        Url = "https://inna.aplikacja/process-instances/finish-as-administrator",
        Auth = auth,
        Parallelism = 2,
        Headers = new() { ["X-Workflow"] = "{{task.workflowId}}" },
        Body = JsonNode.Parse("""{"id":"{{task.id}}","isReject":"{{param.isReject}}","comment":"{{param.comment}}"}"""),
        Parameters =
        [
            new() { Name = "isReject", Label = "Odrzuć", Type = "boolean", Default = JsonValue.Create(false) },
            new() { Name = "comment", Label = "Komentarz", Type = "textarea", Required = true },
        ],
    };

    private static ActionExecutor Executor(FakeHttpHandler handler, ClientCredentialsOptions? cc = null)
    {
        var factory = new FakeHttpClientFactory(handler);
        var exec = Options.Create(new ExecutionOptions { DefaultParallelism = 4, ClientCredentials = cc ?? new() });
        var tokens = new ClientCredentialsTokenProvider(factory, exec, Options.Create(new AuthOptions()));
        return new ActionExecutor(factory, tokens, exec, NullLogger<ActionExecutor>.Instance);
    }

    private static ExecuteActionRequest Request(int count, string comment = "Zamknięte") => new()
    {
        Parameters = new() { ["isReject"] = JsonValue.Create(true), ["comment"] = JsonValue.Create(comment) },
        Tasks = Enumerable.Range(1, count).Select(i => new TaskRef($"task-{i}", $"ZAP-{i}", null, null)).ToList(),
    };

    private static async Task<List<ExecutionItemResult>> RunAll(ActionExecutor executor, ActionDefinition action, ExecuteActionRequest request,
        string? auth = "Bearer user-token", CancellationToken ct = default)
    {
        var results = new List<ExecutionItemResult>();
        await foreach (var r in executor.Run(action, request, auth, "tester", ct).ReadAllAsync()) results.Add(r);
        return results.OrderBy(r => r.Index).ToList();
    }

    [Fact]
    public void Validate_applies_defaults()
    {
        var parameters = new Dictionary<string, JsonNode?> { ["comment"] = JsonValue.Create("x") };
        Executor(new FakeHttpHandler(_ => throw new InvalidOperationException())).ValidateParameters(FinishAction(), parameters);
        Assert.False(parameters["isReject"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Validate_rejects_missing_required_parameter(string? comment)
    {
        var parameters = new Dictionary<string, JsonNode?> { ["comment"] = comment is null ? null : JsonValue.Create(comment) };
        var ex = Assert.Throws<BadRequestException>(() =>
            Executor(new FakeHttpHandler(_ => throw new InvalidOperationException())).ValidateParameters(FinishAction(), parameters));
        Assert.Contains("Komentarz", ex.Message);
    }

    [Fact]
    public void Validate_rejects_value_outside_select_options()
    {
        var action = new ActionDefinition
        {
            Key = "a",
            Url = "https://x",
            Parameters = [new() { Name = "reason", Label = "Powód", Type = "select", Options = [new() { Value = "Duplikat", Label = "Duplikat" }] }],
        };
        var executor = Executor(new FakeHttpHandler(_ => throw new InvalidOperationException()));

        executor.ValidateParameters(action, new() { ["reason"] = JsonValue.Create("Duplikat") });
        Assert.Throws<BadRequestException>(() => executor.ValidateParameters(action, new() { ["reason"] = JsonValue.Create("Inny") }));
    }

    [Fact]
    public async Task Sends_one_request_per_task_with_rendered_body_and_headers()
    {
        var handler = new FakeHttpHandler(_ => FakeHttpHandler.Json("{}"));
        var results = await RunAll(Executor(handler), FinishAction(), Request(3));

        Assert.Equal(3, results.Count);
        Assert.All(results, r => Assert.True(r.Success));
        Assert.Equal([200, 200, 200], results.Select(r => r.StatusCode!.Value));

        var requests = handler.Requests.OrderBy(r => r.Body).ToList();
        Assert.Equal(3, requests.Count);
        Assert.All(requests, r => Assert.Equal(HttpMethod.Post, r.Method));
        var body = JsonNode.Parse(requests[0].Body!)!;
        Assert.Equal("task-1", body["id"]!.GetValue<string>());
        Assert.True(body["isReject"]!.GetValue<bool>());
        Assert.Equal("Zamknięte", body["comment"]!.GetValue<string>());
        Assert.Equal("ZAP-1", requests[0].Headers["X-Workflow"]);
    }

    [Fact]
    public async Task Pass_through_forwards_user_token()
    {
        var handler = new FakeHttpHandler(_ => FakeHttpHandler.Json("{}"));
        await RunAll(Executor(handler), FinishAction(), Request(1), auth: "Bearer user-token");
        Assert.Equal("Bearer user-token", handler.Requests.Single().Authorization);
    }

    [Fact]
    public async Task None_auth_sends_no_token()
    {
        var handler = new FakeHttpHandler(_ => FakeHttpHandler.Json("{}"));
        await RunAll(Executor(handler), FinishAction(ActionAuthMode.None), Request(1), auth: "Bearer user-token");
        Assert.Null(handler.Requests.Single().Authorization);
    }

    [Fact]
    public async Task Client_credentials_fetches_and_caches_application_token()
    {
        var handler = new FakeHttpHandler(r => r.Uri.AbsolutePath == "/token"
            ? FakeHttpHandler.Json("""{"access_token":"app-token","expires_in":3600}""")
            : FakeHttpHandler.Json("{}"));
        var cc = new ClientCredentialsOptions { TokenEndpoint = "https://idp/token", ClientId = "admin-panel", ClientSecret = "s" };

        await RunAll(Executor(handler, cc), FinishAction(ActionAuthMode.ClientCredentials), Request(3), auth: "Bearer user-token");

        var tokenRequests = handler.Requests.Where(r => r.Uri.AbsolutePath == "/token").ToList();
        Assert.Single(tokenRequests);
        Assert.Contains("grant_type=client_credentials", tokenRequests[0].Body);
        Assert.All(handler.Requests.Where(r => r.Uri.AbsolutePath != "/token"), r => Assert.Equal("Bearer app-token", r.Authorization));
    }

    [Fact]
    public async Task Problem_details_error_is_described()
    {
        var handler = new FakeHttpHandler(_ => FakeHttpHandler.Json(
            """{"title":"Zadanie jest już zakończone","status":409}""", HttpStatusCode.Conflict));
        var result = Assert.Single(await RunAll(Executor(handler), FinishAction(), Request(1)));

        Assert.False(result.Success);
        Assert.Equal(409, result.StatusCode);
        Assert.Equal("HTTP 409 Conflict: Zadanie jest już zakończone", result.Error);
    }

    [Fact]
    public async Task Message_and_detail_are_combined()
    {
        var handler = new FakeHttpHandler(_ => FakeHttpHandler.Json(
            """{"message":"Nie znaleziono","detail":"instancja task-1"}""", HttpStatusCode.NotFound));
        var result = Assert.Single(await RunAll(Executor(handler), FinishAction(), Request(1)));
        Assert.Equal("HTTP 404 Not Found: Nie znaleziono | instancja task-1", result.Error);
    }

    [Fact]
    public async Task Plain_text_error_is_truncated()
    {
        var handler = new FakeHttpHandler(_ => FakeHttpHandler.Text(new string('x', 5000), HttpStatusCode.InternalServerError));
        var result = Assert.Single(await RunAll(Executor(handler), FinishAction(), Request(1)));
        Assert.StartsWith("HTTP 500 Internal Server Error: xxx", result.Error);
        Assert.Equal(ActionExecutor.MaxErrorLength + 1, result.Error!.Length);
    }

    [Fact]
    public async Task Network_error_is_reported_without_status()
    {
        var handler = new FakeHttpHandler(_ => throw new HttpRequestException("Connection refused"));
        var result = Assert.Single(await RunAll(Executor(handler), FinishAction(), Request(1)));
        Assert.False(result.Success);
        Assert.Null(result.StatusCode);
        Assert.Contains("Connection refused", result.Error);
    }

    [Fact]
    public async Task Mixed_results_keep_task_identity()
    {
        var handler = new FakeHttpHandler(r => r.Body!.Contains("task-2")
            ? FakeHttpHandler.Json("""{"error":"boom"}""", HttpStatusCode.BadRequest)
            : FakeHttpHandler.Json("{}"));
        var results = await RunAll(Executor(handler), FinishAction(), Request(3));

        Assert.Equal([true, false, true], results.Select(r => r.Success));
        Assert.Equal("ZAP-2", results[1].WorkflowId);
        Assert.Equal(1, results[1].Index);
    }

    [Fact]
    public async Task Url_placeholders_are_encoded()
    {
        var handler = new FakeHttpHandler(_ => FakeHttpHandler.Json("{}"));
        var action = FinishAction();
        action.Url = "https://app/tasks/{{task.id}}/cancel";
        action.Method = "delete";
        action.Body = null;
        var request = new ExecuteActionRequest { Tasks = [new TaskRef("a/b", null, null, null)] };

        await RunAll(Executor(handler), action, request);

        var sent = handler.Requests.Single();
        Assert.Equal(HttpMethod.Delete, sent.Method);
        Assert.Equal("/tasks/a%2Fb/cancel", sent.Uri.AbsolutePath);
        Assert.Null(sent.Body);
    }

    [Fact]
    public async Task Cancellation_stops_processing()
    {
        using var cts = new CancellationTokenSource();
        var handler = new FakeHttpHandler(_ =>
        {
            cts.Cancel();
            return FakeHttpHandler.Json("{}");
        });
        var action = FinishAction();
        action.Parallelism = 1;

        var results = await RunAll(Executor(handler), action, Request(50), ct: cts.Token);

        Assert.True(results.Count < 50);
    }
}
