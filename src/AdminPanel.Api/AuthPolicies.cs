using System.Security.Claims;

namespace AdminPanel.Api;

public static class AuthPolicies
{
    public const string App = "app";

    public static string DisplayName(this ClaimsPrincipal user) =>
        user.FindFirst("preferred_username")?.Value ?? user.FindFirst("name")?.Value ?? user.FindFirst("sub")?.Value ?? "anonymous";
}
