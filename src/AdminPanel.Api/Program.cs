using System.Text.Json.Serialization;
using AdminPanel.Api;
using AdminPanel.Api.Actions;
using AdminPanel.Api.Tasks;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<ElasticsearchOptions>(builder.Configuration.GetSection(ElasticsearchOptions.Section));
builder.Services.Configure<AuthOptions>(builder.Configuration.GetSection(AuthOptions.Section));
builder.Services.Configure<ExecutionOptions>(builder.Configuration.GetSection(ExecutionOptions.Section));

builder.Services.AddControllers().AddJsonOptions(o =>
{
    o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});
builder.Services.AddProblemDetails();

var esOptions = builder.Configuration.GetSection(ElasticsearchOptions.Section).Get<ElasticsearchOptions>() ?? new();
if (esOptions.UseSampleData)
{
    builder.Services.AddSingleton<ITaskRepository, SampleTaskRepository>();
}
else
{
    builder.Services.AddHttpClient<ITaskRepository, ElasticTaskRepository>((sp, http) =>
            ElasticTaskRepository.ConfigureClient(http, sp.GetRequiredService<IOptions<ElasticsearchOptions>>().Value))
        .ConfigurePrimaryHttpMessageHandler(() => Handler(esOptions.SkipCertificateValidation));
}

var execOptions = builder.Configuration.GetSection(ExecutionOptions.Section).Get<ExecutionOptions>() ?? new();
builder.Services.AddSingleton<ActionCatalog>();
builder.Services.AddSingleton<ClientCredentialsTokenProvider>();
builder.Services.AddSingleton<ActionExecutor>();
builder.Services.AddSingleton<ActionJobManager>();
builder.Services.AddSignalR()
    .AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddHttpClient("actions", http => http.Timeout = TimeSpan.FromSeconds(execOptions.RequestTimeoutSeconds))
    .ConfigurePrimaryHttpMessageHandler(() => Handler(execOptions.SkipCertificateValidation));
builder.Services.AddHttpClient("oidc");

var authOptions = builder.Configuration.GetSection(AuthOptions.Section).Get<AuthOptions>() ?? new();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.Authority = authOptions.Authority;
        o.RequireHttpsMetadata = authOptions.RequireHttpsMetadata;
        o.MapInboundClaims = false;
        o.TokenValidationParameters.ValidateAudience = !string.IsNullOrEmpty(authOptions.Audience);
        o.TokenValidationParameters.ValidAudience = authOptions.Audience;
        o.TokenValidationParameters.NameClaimType = "name";
        o.TokenValidationParameters.RoleClaimType = "role";
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                    ctx.Token = token;
                return Task.CompletedTask;
            },
        };
    });
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(AuthPolicies.App, p =>
    {
        if (!authOptions.Enabled)
        {
            p.RequireAssertion(_ => true);
            return;
        }
        p.RequireAuthenticatedUser();
        if (!string.IsNullOrEmpty(authOptions.RequiredRole)) p.RequireRole(authOptions.RequiredRole);
    });

var app = builder.Build();

app.UseExceptionHandler(errorApp => errorApp.Run(async ctx =>
{
    var ex = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    ctx.Response.StatusCode = ex is BadRequestException ? 400 : 500;
    await Results.Problem(detail: ex?.Message, statusCode: ctx.Response.StatusCode).ExecuteAsync(ctx);
}));

if (app.Configuration["PathBase"] is { Length: > 0 } pathBase)
    app.UsePathBase(pathBase);

app.UseStaticFiles();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<JobsHub>("/hubs/jobs");

app.MapFallback(async (HttpContext ctx, IWebHostEnvironment env) =>
{
    if (ctx.Request.Path.StartsWithSegments("/api") || ctx.Request.Path.StartsWithSegments("/hubs"))
        return Results.NotFound();

    var file = env.WebRootFileProvider.GetFileInfo("index.html");
    if (!file.Exists) return Results.NotFound("Brak wwwroot/index.html - zbuduj frontend (npm run build).");

    using var reader = new StreamReader(file.CreateReadStream());
    var html = await reader.ReadToEndAsync();
    var baseHref = System.Net.WebUtility.HtmlEncode(ctx.Request.PathBase.Value?.TrimEnd('/') + "/");
    html = html.Replace("<base href=\"/\" />", $"<base href=\"{baseHref}\" />");

    ctx.Response.Headers.CacheControl = "no-cache";
    return Results.Content(html, "text/html; charset=utf-8");
});

app.Run();

static HttpMessageHandler Handler(bool skipCertValidation) => new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(5),
    SslOptions = skipCertValidation
        ? new System.Net.Security.SslClientAuthenticationOptions { RemoteCertificateValidationCallback = (_, _, _, _) => true }
        : new System.Net.Security.SslClientAuthenticationOptions(),
};
