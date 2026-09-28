using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using AdminPanel.Api.Tasks;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Actions;

/// <summary>
/// Wykonuje akcję dla listy zadań: po jednym requeście HTTP na zadanie, z ograniczoną równoległością.
/// Wyniki są publikowane na bieżąco (kanał), żeby UI mogło pokazywać postęp.
/// </summary>
public sealed class ActionExecutor(
    IHttpClientFactory httpFactory,
    ClientCredentialsTokenProvider ccTokens,
    IOptions<ExecutionOptions> options,
    ILogger<ActionExecutor> log)
{
    public const int MaxErrorLength = 2000;

    public void ValidateParameters(ActionDefinition action, Dictionary<string, JsonNode?> parameters)
    {
        foreach (var p in action.Parameters)
        {
            parameters.TryGetValue(p.Name, out var v);
            if (v is null && p.Default is not null)
                parameters[p.Name] = v = p.Default.DeepClone();

            var empty = v is null || (v is JsonValue jv && jv.GetValueKind() == JsonValueKind.String && string.IsNullOrWhiteSpace(jv.GetValue<string>()));
            if (p.Required && empty)
                throw new BadRequestException($"Parametr \"{p.Label}\" jest wymagany.");

            if (!empty && p.Type == "select" && p.Options.Count > 0 &&
                !p.Options.Any(o => o.Value == (v is JsonValue sv && sv.GetValueKind() == JsonValueKind.String ? sv.GetValue<string>() : v!.ToJsonString())))
                throw new BadRequestException($"Niedozwolona wartość parametru \"{p.Label}\".");
        }
    }

    public ChannelReader<ExecutionItemResult> Run(
        ActionDefinition action, ExecuteActionRequest request, string? userAuthorization, string user, CancellationToken ct)
    {
        var channel = Channel.CreateUnbounded<ExecutionItemResult>(new UnboundedChannelOptions { SingleReader = true });
        var parallelism = Math.Clamp(action.Parallelism ?? options.Value.DefaultParallelism, 1, 32);
        var http = httpFactory.CreateClient("actions");
        var items = request.Tasks.Select((t, i) => (Task: t, Index: i));

        log.LogInformation("Użytkownik {User} uruchamia akcję {Action} dla {Count} zadań, parametry: {Params}",
            user, action.Key, request.Tasks.Count, JsonSerializer.Serialize(request.Parameters));

        _ = Task.Run(async () =>
        {
            try
            {
                await Parallel.ForEachAsync(items, new ParallelOptions { MaxDegreeOfParallelism = parallelism, CancellationToken = ct },
                    async (item, token) =>
                    {
                        var result = await ExecuteOneAsync(http, action, item.Task, item.Index, request.Parameters, userAuthorization, token);
                        log.LogInformation("Akcja {Action} [{User}] zadanie {TaskId} ({WorkflowId}): {Status} {Error}",
                            action.Key, user, result.Id, result.WorkflowId, result.StatusCode, result.Error);
                        await channel.Writer.WriteAsync(result, token);
                    });
                channel.Writer.TryComplete();
            }
            catch (OperationCanceledException)
            {
                log.LogWarning("Akcja {Action} [{User}] przerwana.", action.Key, user);
                channel.Writer.TryComplete();
            }
            catch (Exception ex)
            {
                channel.Writer.TryComplete(ex);
            }
        }, CancellationToken.None);

        return channel.Reader;
    }

    private async Task<ExecutionItemResult> ExecuteOneAsync(HttpClient http, ActionDefinition action, TaskRef task, int index,
        IReadOnlyDictionary<string, JsonNode?> parameters, string? userAuthorization, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            var url = ActionTemplate.ApplyToString(action.Url, task, parameters, Uri.EscapeDataString);
            using var req = new HttpRequestMessage(new HttpMethod(action.Method.ToUpperInvariant()), url);

            var body = ActionTemplate.ApplyToJson(action.Body, task, parameters);
            if (body is not null)
                req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");

            foreach (var (name, value) in action.Headers)
                req.Headers.TryAddWithoutValidation(name, ActionTemplate.ApplyToString(value, task, parameters));

            switch (action.Auth)
            {
                case ActionAuthMode.PassThrough when !string.IsNullOrEmpty(userAuthorization):
                    req.Headers.Authorization = AuthenticationHeaderValue.Parse(userAuthorization);
                    break;
                case ActionAuthMode.ClientCredentials:
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await ccTokens.GetTokenAsync(ct));
                    break;
            }

            using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseContentRead, ct);
            var status = (int)resp.StatusCode;
            if (resp.IsSuccessStatusCode)
                return new ExecutionItemResult(index, task.Id, task.WorkflowId, true, status, null, sw.ElapsedMilliseconds);

            var text = await resp.Content.ReadAsStringAsync(ct);
            return new ExecutionItemResult(index, task.Id, task.WorkflowId, false, status,
                DescribeError(resp, text), sw.ElapsedMilliseconds);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (TaskCanceledException)
        {
            return new ExecutionItemResult(index, task.Id, task.WorkflowId, false, null,
                $"Przekroczono limit czasu ({options.Value.RequestTimeoutSeconds}s)", sw.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            var msg = ex is HttpRequestException hre && hre.InnerException is not null
                ? $"{hre.Message} ({hre.InnerException.Message})" : ex.Message;
            return new ExecutionItemResult(index, task.Id, task.WorkflowId, false, null, msg, sw.ElapsedMilliseconds);
        }
    }

    /// <summary>Wyciąga czytelny komunikat z typowych formatów błędów (ProblemDetails, {message}, {error}).</summary>
    private static string DescribeError(HttpResponseMessage resp, string body)
    {
        var prefix = $"HTTP {(int)resp.StatusCode} {resp.ReasonPhrase}";
        if (string.IsNullOrWhiteSpace(body))
        {
            if (resp.Headers.WwwAuthenticate.Count > 0) return $"{prefix}: {resp.Headers.WwwAuthenticate}";
            return prefix;
        }

        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object)
            {
                var parts = new List<string>();
                foreach (var name in new[] { "message", "Message", "title", "detail", "error", "error_description", "errorMessage" })
                    if (root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString()))
                        parts.Add(v.GetString()!);
                if (root.TryGetProperty("errors", out var errors))
                    parts.Add(errors.GetRawText());
                if (parts.Count > 0) return Truncate($"{prefix}: {string.Join(" | ", parts.Distinct())}");
            }
        }
        catch (JsonException) { /* nie-JSON - zwracamy surowy tekst */ }

        return Truncate($"{prefix}: {body.Trim()}");
    }

    private static string Truncate(string s) => s.Length <= MaxErrorLength ? s : s[..MaxErrorLength] + "…";
}
