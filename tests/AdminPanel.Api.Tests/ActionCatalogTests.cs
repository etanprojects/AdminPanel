using AdminPanel.Api.Actions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Tests;

public sealed class ActionCatalogTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("adminpanel-tests-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private ActionCatalog Catalog(string file = "actions.json", int parallelism = 4) => new(
        Options.Create(new ExecutionOptions { ActionsFile = file, DefaultParallelism = parallelism }),
        new FakeHostEnvironment(_dir),
        NullLogger<ActionCatalog>.Instance);

    private void Write(string json, string file = "actions.json") => File.WriteAllText(Path.Combine(_dir, file), json);

    private const string Valid = """
        {
          "actions": [
            {
              "key": "finish-as-administrator",
              "name": "Zakończ jako administrator",
              "method": "post",
              "url": "https://inna.aplikacja/process-instances/{{task.id}}/finish",
              "auth": "ClientCredentials",
              "headers": { "X-Secret": "s3cret" },
              "body": { "id": "{{task.id}}", "isReject": "{{param.isReject}}" },
              "parameters": [
                { "name": "isReject", "label": "Odrzuć", "type": "boolean", "default": false },
                { "name": "reason", "label": "Powód", "type": "select", "options": [ { "value": "a", "label": "A" } ] }
              ]
            },
          ]
        }
        """;

    [Fact]
    public void Loads_actions_from_content_root()
    {
        Write(Valid);
        var action = Assert.Single(Catalog().GetAll());
        Assert.Equal("finish-as-administrator", action.Key);
        Assert.Equal(ActionAuthMode.ClientCredentials, action.Auth);
        Assert.Equal(2, action.Parameters.Count);
        Assert.Equal("a", action.Parameters[1].Options.Single().Value);
    }

    [Fact]
    public void Find_is_case_insensitive()
    {
        Write(Valid);
        Assert.NotNull(Catalog().Find("FINISH-AS-ADMINISTRATOR"));
        Assert.Null(Catalog().Find("other"));
    }

    [Fact]
    public void Info_hides_headers_and_normalizes_method()
    {
        Write(Valid);
        var catalog = Catalog(parallelism: 6);
        var info = catalog.ToInfo(catalog.GetAll()[0]);
        Assert.Equal("POST", info.Method);
        Assert.Equal(6, info.Parallelism);
        Assert.DoesNotContain("s3cret", System.Text.Json.JsonSerializer.Serialize(info));
    }

    [Fact]
    public void Missing_file_gives_empty_catalog() =>
        Assert.Empty(Catalog("does-not-exist.json").GetAll());

    [Fact]
    public void Absolute_path_is_supported()
    {
        Write(Valid, "custom.json");
        Assert.Single(Catalog(Path.Combine(_dir, "custom.json")).GetAll());
    }

    [Fact]
    public void Reloads_after_file_change()
    {
        Write(Valid);
        var catalog = Catalog();
        Assert.Single(catalog.GetAll());

        Write("""{"actions":[{"key":"a","url":"https://x"},{"key":"b","url":"https://y"}]}""");
        File.SetLastWriteTimeUtc(Path.Combine(_dir, "actions.json"), DateTime.UtcNow.AddMinutes(1));

        Assert.Equal(2, catalog.GetAll().Count);
    }

    [Fact]
    public void Duplicate_keys_are_rejected()
    {
        Write("""{"actions":[{"key":"a","url":"https://x"},{"key":"A","url":"https://y"}]}""");
        var ex = Assert.Throws<InvalidOperationException>(() => Catalog().GetAll());
        Assert.Contains("a", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Missing_key_is_rejected()
    {
        Write("""{"actions":[{"name":"no key","url":"https://x"}]}""");
        Assert.Throws<InvalidOperationException>(() => Catalog().GetAll());
    }

    [Fact]
    public void Relative_url_is_rejected()
    {
        Write("""{"actions":[{"key":"a","url":"relative/path"}]}""");
        Assert.Throws<InvalidOperationException>(() => Catalog().GetAll());
    }
}
