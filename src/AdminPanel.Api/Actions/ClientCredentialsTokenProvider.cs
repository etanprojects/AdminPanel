using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Actions;

public sealed class ClientCredentialsTokenProvider(
    IHttpClientFactory httpFactory, IOptions<ExecutionOptions> execOptions, IOptions<AuthOptions> authOptions)
{
    private readonly SemaphoreSlim _lock = new(1, 1);
    private string? _token;
    private DateTimeOffset _expiresAt;

    public async Task<string> GetTokenAsync(CancellationToken ct)
    {
        if (_token is not null && DateTimeOffset.UtcNow < _expiresAt) return _token;

        await _lock.WaitAsync(ct);
        try
        {
            if (_token is not null && DateTimeOffset.UtcNow < _expiresAt) return _token;

            var cc = execOptions.Value.ClientCredentials;
            if (string.IsNullOrEmpty(cc.ClientId))
                throw new InvalidOperationException("Brak konfiguracji Execution:ClientCredentials.");

            var http = httpFactory.CreateClient("oidc");
            var tokenEndpoint = cc.TokenEndpoint;
            if (string.IsNullOrEmpty(tokenEndpoint))
            {
                var discoveryUrl = authOptions.Value.Authority.TrimEnd('/') + "/.well-known/openid-configuration";
                var discovery = await http.GetFromJsonAsync<JsonElement>(discoveryUrl, ct);
                tokenEndpoint = discovery.GetProperty("token_endpoint").GetString();
            }

            var form = new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = cc.ClientId,
                ["client_secret"] = cc.ClientSecret,
            };
            if (!string.IsNullOrEmpty(cc.Scope)) form["scope"] = cc.Scope;

            using var resp = await http.PostAsync(tokenEndpoint, new FormUrlEncodedContent(form), ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException($"Nie udało się pobrać tokenu client_credentials ({(int)resp.StatusCode}): {body}");

            using var doc = JsonDocument.Parse(body);
            _token = doc.RootElement.GetProperty("access_token").GetString()!;
            var expiresIn = doc.RootElement.TryGetProperty("expires_in", out var e) ? e.GetInt32() : 300;
            _expiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Max(30, expiresIn - 60));
            return _token;
        }
        finally
        {
            _lock.Release();
        }
    }
}
