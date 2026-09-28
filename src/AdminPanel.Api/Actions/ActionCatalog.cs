using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Actions;

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

    private IEnumerable<string> CandidatePaths()
    {
        var file = options.Value.ActionsFile;
        if (Path.IsPathRooted(file))
        {
            yield return file;
            yield break;
        }
        yield return Path.Combine(env.ContentRootPath, file);
        yield return Path.Combine(AppContext.BaseDirectory, file);
    }

    public IReadOnlyList<ActionDefinition> GetAll()
    {
        var candidates = CandidatePaths().Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var path = candidates.FirstOrDefault(File.Exists);
        if (path is null)
        {
            log.LogWarning("Brak pliku z definicjami akcji. Sprawdzone ścieżki: {Paths}", string.Join("; ", candidates));
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
