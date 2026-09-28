using System.Collections.Concurrent;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace AdminPanel.Api.Actions;

public enum JobState { Running, Completed, Cancelled, Failed }

public sealed class ActionJob
{
    public Guid Id { get; } = Guid.NewGuid();
    public required string ActionKey { get; init; }
    public required string ActionName { get; init; }
    public required int Total { get; init; }
    public required string StartedBy { get; init; }
    public DateTimeOffset StartedAt { get; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? FinishedAt { get; set; }
    public JobState State { get; set; } = JobState.Running;
    public string? Error { get; set; }
    public int Succeeded;
    public int Failed;
    public CancellationTokenSource Cts { get; } = new();

    private readonly List<ExecutionItemResult> _results = [];
    private readonly Lock _lock = new();

    public void Add(ExecutionItemResult r)
    {
        lock (_lock) _results.Add(r);
        if (r.Success) Interlocked.Increment(ref Succeeded); else Interlocked.Increment(ref Failed);
    }

    public JobSnapshot Snapshot()
    {
        lock (_lock)
            return new JobSnapshot(Id, ActionKey, ActionName, Total, State, _results.Count, Succeeded, Failed, Error,
                StartedBy, StartedAt, FinishedAt, _results.ToList());
    }

    public JobProgress Progress(ExecutionItemResult? result) =>
        new(Id, State, Succeeded + Failed, Succeeded, Failed, Total, result, Error);
}

public sealed record JobSnapshot(
    Guid JobId, string ActionKey, string ActionName, int Total, JobState State, int Processed, int Succeeded, int Failed,
    string? Error, string StartedBy, DateTimeOffset StartedAt, DateTimeOffset? FinishedAt, IReadOnlyList<ExecutionItemResult> Results);

public sealed record JobProgress(
    Guid JobId, JobState State, int Processed, int Succeeded, int Failed, int Total, ExecutionItemResult? Result, string? Error);

public sealed class ActionJobManager(ActionExecutor executor, IHubContext<JobsHub> hub, ILogger<ActionJobManager> log)
{
    private static readonly TimeSpan Retention = TimeSpan.FromHours(24);
    private readonly ConcurrentDictionary<Guid, ActionJob> _jobs = new();

    public static string Group(Guid id) => $"job:{id}";

    public ActionJob Start(ActionDefinition action, ExecuteActionRequest request, string? userAuthorization, string user)
    {
        Cleanup();
        var job = new ActionJob { ActionKey = action.Key, ActionName = action.Name, Total = request.Tasks.Count, StartedBy = user };
        _jobs[job.Id] = job;

        _ = Task.Run(async () =>
        {
            var group = hub.Clients.Group(Group(job.Id));
            try
            {
                var reader = executor.Run(action, request, userAuthorization, user, job.Cts.Token);
                await foreach (var r in reader.ReadAllAsync())
                {
                    job.Add(r);
                    await group.SendAsync("progress", job.Progress(r));
                }
                job.State = job.Cts.IsCancellationRequested ? JobState.Cancelled : JobState.Completed;
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Job {JobId} zakończony błędem", job.Id);
                job.State = JobState.Failed;
                job.Error = ex.Message;
            }
            finally
            {
                job.FinishedAt = DateTimeOffset.UtcNow;
                log.LogInformation("Job {JobId} ({Action}, {User}): {State}, {Ok}/{Total} udanych, {Failed} błędnych",
                    job.Id, job.ActionKey, user, job.State, job.Succeeded, job.Total, job.Failed);
                await group.SendAsync("finished", job.Progress(null));
            }
        });

        return job;
    }

    public ActionJob? Get(Guid id) => _jobs.GetValueOrDefault(id);

    public IEnumerable<ActionJob> List() => _jobs.Values.OrderByDescending(j => j.StartedAt);

    private void Cleanup()
    {
        foreach (var (id, job) in _jobs)
            if (job.FinishedAt is { } f && DateTimeOffset.UtcNow - f > Retention)
                _jobs.TryRemove(id, out _);
    }
}

[Authorize(Policy = AuthPolicies.App)]
public sealed class JobsHub(ActionJobManager jobs) : Hub
{
    public async Task<JobSnapshot?> Subscribe(Guid jobId)
    {
        var job = jobs.Get(jobId);
        if (job is null) return null;
        await Groups.AddToGroupAsync(Context.ConnectionId, ActionJobManager.Group(jobId));
        return job.Snapshot();
    }

    public Task Unsubscribe(Guid jobId) => Groups.RemoveFromGroupAsync(Context.ConnectionId, ActionJobManager.Group(jobId));

    public void Cancel(Guid jobId) => jobs.Get(jobId)?.Cts.Cancel();
}
