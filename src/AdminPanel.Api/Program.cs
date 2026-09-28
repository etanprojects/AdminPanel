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

// ---------------------------------------------------------------- Elasticsearch
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

// ---------------------------------------------------------------- Akcje + postęp przez WebSocket (SignalR)
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

// ---------------------------------------------------------------- Uwierzytelnianie
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
        // WebSocket nie przenosi nagłówka Authorization - SignalR przekazuje token w query stringu
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

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<JobsHub>("/hubs/jobs");
app.MapFallbackToFile("index.html");

app.Run();

static HttpMessageHandler Handler(bool skipCertValidation) => new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(5),
    SslOptions = skipCertValidation
        ? new System.Net.Security.SslClientAuthenticationOptions { RemoteCertificateValidationCallback = (_, _, _, _) => true }
        : new System.Net.Security.SslClientAuthenticationOptions(),
};
