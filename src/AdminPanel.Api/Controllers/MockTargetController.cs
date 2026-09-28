using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace AdminPanel.Api.Controllers;

/// <summary>
/// Atrapa systemu docelowego do testów lokalnych (tylko środowisko Development).
/// Losowo zwraca błędy 404/409/500, żeby było widać obsługę błędów w UI.
/// </summary>
[ApiController]
[Route("mock")]
public sealed class MockTargetController(IHostEnvironment env) : ControllerBase
{
    [HttpPost("process-instances/finish-as-administrator")]
    public async Task<IActionResult> FinishAsAdministrator([FromBody] JsonElement body)
    {
        if (!env.IsDevelopment()) return NotFound();

        await Task.Delay(Random.Shared.Next(100, 600));
        return Random.Shared.Next(100) switch
        {
            < 10 => Problem(title: "Zadanie jest już zakończone", statusCode: 409),
            < 15 => Problem(detail: "Wewnętrzny błąd systemu procesowego", statusCode: 500),
            < 18 => NotFound(new { message = $"Nie znaleziono instancji procesu {body.GetProperty("id")}" }),
            _ => Ok(new { ok = true }),
        };
    }
}
