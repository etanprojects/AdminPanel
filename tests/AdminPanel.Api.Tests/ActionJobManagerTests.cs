using System.Net;
using System.Text.Json.Nodes;
using AdminPanel.Api.Actions;
using AdminPanel.Api.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Tests;

public class ActionJobManagerTests
{
    private static readonly ActionDefinition Action = new()
    {
        Key = "finish",
        Name = "Zakończ",
        Url = "https://app/finish",
        Auth = ActionAuthMode.None,
        Body = JsonNode.Parse("""{"id":"{{task.id}}"}"""),
    };

    private static (ActionJobManager Manager, FakeHubContext Hub) Create(FakeHttpHandler handler)
    {
        var factory = new FakeHttpClientFactory(handler);
        var exec = Options.Create(new ExecutionOptions());
        var executor = new ActionExecutor(factory, new ClientCredentialsTokenProvider(factory, exec, Options.Create(new AuthOptions())),
            exec, NullLogger<ActionExecutor>.Instance);
        var hub = new FakeHubContext();
        return (new ActionJobManager(executor, hub, NullLogger<ActionJobManager>.Instance), hub);
    }

    private static ExecuteActionRequest Tasks(int count) => new()
    {
        Tasks = Enumerable.Range(1, count).Select(i => new TaskRef($"t{i}", $"ZAP-{i}", null, null)).ToList(),
    };

    private static async Task WaitUntilFinished(ActionJob job)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (job.FinishedAt is null && DateTime.UtcNow < deadline) await Task.Delay(10);
        Assert.NotNull(job.FinishedAt);
    }

    [Fact]
    public async Task Job_completes_with_counts_and_broadcasts_progress()
    {
        var handler = new FakeHttpHandler(r => r.Body!.Contains("\"t2\"")
            ? FakeHttpHandler.Json("""{"title":"Konflikt"}""", HttpStatusCode.Conflict)
            : FakeHttpHandler.Json("{}"));
        var (manager, hub) = Create(handler);

        var job = manager.Start(Action, Tasks(3), null, "tester");
        await WaitUntilFinished(job);

        var snapshot = job.Snapshot();
        Assert.Equal(JobState.Completed, snapshot.State);
        Assert.Equal(3, snapshot.Processed);
        Assert.Equal(2, snapshot.Succeeded);
        Assert.Equal(1, snapshot.Failed);
        Assert.Equal("tester", snapshot.StartedBy);
        Assert.Equal(3, snapshot.Results.Count);

        var sent = hub.Sent.ToList();
        Assert.All(sent, s => Assert.Equal(ActionJobManager.Group(job.Id), s.Group));
        Assert.Equal(3, sent.Count(s => s.Method == "progress"));
        var finished = Assert.Single(sent, s => s.Method == "finished");
        var progress = Assert.IsType<JobProgress>(finished.Args[0]);
        Assert.Equal(JobState.Completed, progress.State);
        Assert.Equal(3, progress.Processed);
    }

    [Fact]
    public async Task Cancelled_job_is_marked_as_cancelled()
    {
        var release = new TaskCompletionSource();
        var handler = new FakeHttpHandler(_ =>
        {
            release.Task.Wait(TimeSpan.FromSeconds(5));
            return FakeHttpHandler.Json("{}");
        });
        var (manager, _) = Create(handler);

        var job = manager.Start(Action, Tasks(20), null, "tester");
        job.Cts.Cancel();
        release.SetResult();
        await WaitUntilFinished(job);

        Assert.Equal(JobState.Cancelled, job.State);
        Assert.True(job.Snapshot().Processed < 20);
    }

    [Fact]
    public void Jobs_are_listed_newest_first_and_found_by_id()
    {
        var (manager, _) = Create(new FakeHttpHandler(_ => FakeHttpHandler.Json("{}")));
        var first = manager.Start(Action, Tasks(1), null, "a");
        var second = manager.Start(Action, Tasks(1), null, "b");

        Assert.Same(first, manager.Get(first.Id));
        Assert.Null(manager.Get(Guid.NewGuid()));
        Assert.Contains(second, manager.List());
        Assert.Equal(2, manager.List().Count());
    }

    [Fact]
    public void Group_name_contains_job_id()
    {
        var id = Guid.NewGuid();
        Assert.Equal($"job:{id}", ActionJobManager.Group(id));
    }
}
