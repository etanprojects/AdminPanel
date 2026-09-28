namespace AdminPanel.Api;

public sealed class ElasticsearchOptions
{
    public const string Section = "Elasticsearch";

    /// <summary>true = dane przykładowe w pamięci (bez Elasticsearcha), do developmentu UI.</summary>
    public bool UseSampleData { get; set; }

    public string Url { get; set; } = "http://localhost:9200";
    public string Index { get; set; } = "basic_basetask";
    public string? Username { get; set; }
    public string? Password { get; set; }
    public string? ApiKey { get; set; }
    public bool SkipCertificateValidation { get; set; }

    /// <summary>Strefa czasowa, w której interpretowane są daty z filtrów (parametr time_zone w range query).</summary>
    public string TimeZone { get; set; } = "Europe/Warsaw";

    /// <summary>Maksymalna liczba zadań zwracana przy "zaznacz wszystkie" i eksporcie CSV.</summary>
    public int MaxBulkResults { get; set; } = 20000;

    /// <summary>Limit wartości w słownikach filtrów (processName, currentStepName, handledByName).</summary>
    public int FacetSize { get; set; } = 500;

    /// <summary>
    /// Mapowanie logicznych pól na pola w indeksie. Dla pól tekstowych z dynamicznym mapowaniem
    /// filtrowanie/sortowanie musi iść po subpolu .keyword.
    /// </summary>
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

    /// <summary>false = brak logowania (tylko lokalny development).</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Issuer serwera OpenID Connect.</summary>
    public string Authority { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string Scope { get; set; } = "openid profile";

    /// <summary>Jeśli puste - audience tokenu nie jest walidowane.</summary>
    public string? Audience { get; set; }

    /// <summary>Opcjonalna rola wymagana do korzystania z aplikacji (claim "role").</summary>
    public string? RequiredRole { get; set; }

    public bool RequireHttpsMetadata { get; set; } = true;
}

public sealed class ExecutionOptions
{
    public const string Section = "Execution";

    /// <summary>Ścieżka do pliku z definicjami akcji (względna do katalogu aplikacji).</summary>
    public string ActionsFile { get; set; } = "actions.json";

    /// <summary>Domyślna liczba równoległych requestów (akcja może nadpisać).</summary>
    public int DefaultParallelism { get; set; } = 4;

    public int RequestTimeoutSeconds { get; set; } = 60;

    public bool SkipCertificateValidation { get; set; }

    /// <summary>Konfiguracja dla akcji z Auth = "ClientCredentials".</summary>
    public ClientCredentialsOptions ClientCredentials { get; set; } = new();
}

public sealed class ClientCredentialsOptions
{
    /// <summary>Jeśli puste - używany jest token endpoint z discovery serwera Auth:Authority.</summary>
    public string? TokenEndpoint { get; set; }
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string? Scope { get; set; }
}
