using AdminPanel.Api.Actions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdminPanel.Api.Controllers;

[ApiController]
[Route("api")]
[Authorize(Policy = AuthPolicies.App)]
public sealed class ActionsController(ActionCatalog catalog, ActionExecutor executor, ActionJobManager jobs) : ControllerBase
{
    [HttpGet("actions")]
    public IEnumerable<ActionInfo> GetActions() => catalog.GetAll().Select(catalog.ToInfo);

    [HttpPost("actions/{key}/jobs")]
    public IActionResult Start(string key, [FromBody] ExecuteActionRequest request)
    {
        var action = catalog.Find(key);
        if (action is null) return NotFound(new { error = $"Nieznana akcja: {key}" });
        if (request.Tasks.Count == 0) return BadRequest(new { error = "Brak zadań do przetworzenia." });
        executor.ValidateParameters(action, request.Parameters);

        var userAuth = Request.Headers.Authorization.ToString();
        var job = jobs.Start(action, request, string.IsNullOrEmpty(userAuth) ? null : userAuth, User.DisplayName());
        return Ok(new { jobId = job.Id });
    }

    [HttpGet("jobs")]
    public IEnumerable<JobSnapshot> GetJobs() => jobs.List().Select(j => j.Snapshot() with { Results = [] });

    [HttpGet("jobs/{id:guid}")]
    public IActionResult GetJob(Guid id) => jobs.Get(id) is { } job ? Ok(job.Snapshot()) : NotFound();

    [HttpPost("jobs/{id:guid}/cancel")]
    public IActionResult Cancel(Guid id)
    {
        if (jobs.Get(id) is not { } job) return NotFound();
        job.Cts.Cancel();
        return Accepted();
    }
}
