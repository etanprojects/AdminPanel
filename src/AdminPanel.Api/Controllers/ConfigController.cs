using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Controllers;

[ApiController]
[Route("api")]
public sealed class ConfigController(IOptions<AuthOptions> auth, IOptions<ElasticsearchOptions> es) : ControllerBase
{
    [HttpGet("config")]
    [AllowAnonymous]
    public object GetConfig() => new
    {
        auth = new { auth.Value.Enabled, auth.Value.Authority, auth.Value.ClientId, auth.Value.Scope },
        sampleData = es.Value.UseSampleData,
        maxBulkResults = es.Value.MaxBulkResults,
    };

    [HttpGet("me")]
    [Authorize(Policy = AuthPolicies.App)]
    public object Me() => new { name = User.DisplayName(), claims = User.Claims.Select(c => new { c.Type, c.Value }) };
}
