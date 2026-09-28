using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Actions;

/// <summary>
/// Wczytuje definicje akcji z pliku JSON. Plik jest przeładowywany automatycznie po zmianie
/// (bez restartu aplikacji), więc nowe typy akcji dodaje się edytując actions.json.
/// </summary>
public sealed class ActionCatalog(IOptions<ExecutionOptions> options, IHostEnvironment env, ILogger<ActionCatalog> log)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly Lock _lock = new();
    private DateTime _loadedWriteTime;
    private IReadOnlyList<ActionDefinition> _actions = [];

    private string FilePath => Path.IsPathRooted(options.Value.ActionsFile)
        ? options.Value.ActionsFile
        : Path.Combine(env.ContentRootPath, options.Value.ActionsFile);

    public IReadOnlyList<ActionDefinition> GetAll()
    {
        var path = FilePath;
        if (!File.Exists(path))
        {
            log.LogWarning("Brak pliku z definicjami akcji: {Path}", path);
            return [];
        }

        var writeTime = File.GetLastWriteTimeUtc(path);
        lock (_lock)
        {
            if (writeTime == _loadedWriteTime) return _actions;

            var loaded = JsonSerializer.Deserialize<ActionsFile>(File.ReadAllText(path), JsonOptions)?.Actions ?? [];
            Validate(loaded);
            _actions = loaded;
            _loadedWriteTime = writeTime;
            log.LogInformation("Wczytano {Count} definicji akcji z {Path}", loaded.Count, path);
            return _actions;
        }
    }

    public ActionDefinition? Find(string key) =>
        GetAll().FirstOrDefault(a => string.Equals(a.Key, key, StringComparison.OrdinalIgnoreCase));

    public ActionInfo ToInfo(ActionDefinition a) => new(
        a.Key, a.Name, a.Description, a.Color, a.Method.ToUpperInvariant(), a.Url, a.Body, a.Auth,
        a.Parallelism ?? options.Value.DefaultParallelism, a.Parameters);

    private static void Validate(List<ActionDefinition> actions)
    {
        var dup = actions.GroupBy(a => a.Key, StringComparer.OrdinalIgnoreCase).FirstOrDefault(g => g.Count() > 1);
        if (dup is not null) throw new InvalidOperationException($"Zduplikowany klucz akcji: {dup.Key}");
        foreach (var a in actions)
        {
            if (string.IsNullOrWhiteSpace(a.Key)) throw new InvalidOperationException("Akcja bez klucza (Key).");
            if (!Uri.TryCreate(a.Url.Split("{{")[0], UriKind.Absolute, out _))
                throw new InvalidOperationException($"Akcja {a.Key}: niepoprawny Url.");
        }
    }

    private sealed class ActionsFile
    {
        public List<ActionDefinition> Actions { get; set; } = [];
    }
}
