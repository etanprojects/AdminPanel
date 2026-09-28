namespace AdminPanel.Api;

public sealed class ElasticsearchOptions
{
    public const string Section = "Elasticsearch";

    public bool UseSampleData { get; set; }

    public string Url { get; set; } = "http://localhost:9200";
    public string Index { get; set; } = "basic_basetask";
    public string? Username { get; set; }
    public string? Password { get; set; }
    public string? ApiKey { get; set; }
    public bool SkipCertificateValidation { get; set; }

    public string TimeZone { get; set; } = "Europe/Warsaw";

    public int MaxBulkResults { get; set; } = 20000;

    public int FacetSize { get; set; } = 500;

    public Dictionary<string, string> Fields { get; set; } = new()
    {
        ["id"] = "id.keyword",
        ["workflowId"] = "workflowId.keyword",
        ["processName"] = "processName.keyword",
        ["currentStepName"] = "currentStepName.keyword",
        ["handledByName"] = "handledByName.keyword",
        ["createdAt"] = "createdAt",
        ["updatedAt"] = "updatedAt",
    };

    public string Field(string logical) => Fields.TryGetValue(logical, out var f) ? f : logical;
}

public sealed class AuthOptions
{
    public const string Section = "Auth";

    public bool Enabled { get; set; } = true;

    public string Authority { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string Scope { get; set; } = "openid profile";

    public string? Audience { get; set; }

    public string? RequiredRole { get; set; }

    public bool RequireHttpsMetadata { get; set; } = true;
}

public sealed class ExecutionOptions
{
    public const string Section = "Execution";

    public string ActionsFile { get; set; } = "actions.json";

    public int DefaultParallelism { get; set; } = 4;

    public int RequestTimeoutSeconds { get; set; } = 60;

    public bool SkipCertificateValidation { get; set; }

    public ClientCredentialsOptions ClientCredentials { get; set; } = new();
}

public sealed class ClientCredentialsOptions
{
    public string? TokenEndpoint { get; set; }
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string? Scope { get; set; }
}
