using System.Globalization;
using AdminPanel.Api.Tasks;
using Microsoft.Extensions.Options;

namespace AdminPanel.Api.Tests;

public class SampleTaskRepositoryTests
{
    private readonly SampleTaskRepository _repo = new(Options.Create(new ElasticsearchOptions { MaxBulkResults = 50000 }));

    private Task<TaskSearchResult> Search(TaskFilter filter, string? sort = null, string? dir = null) =>
        _repo.SearchAsync(new TaskSearchRequest { Filter = filter, PageSize = 10000, SortField = sort, SortDir = dir }, default);

    private static DateTime Parse(string? value) => DateTime.Parse(value!, CultureInfo.InvariantCulture);

    [Fact]
    public async Task Star_query_returns_everything()
    {
        var all = await _repo.CountAsync(new TaskFilter(), default);
        Assert.Equal(all, await _repo.CountAsync(new TaskFilter { Query = "*" }, default));
    }

    [Fact]
    public async Task Only_from_date_filters_lower_bound()
    {
        var result = await Search(new TaskFilter { CreatedFrom = "2025-10-01T00:00:00" });
        Assert.NotEmpty(result.Items);
        Assert.All(result.Items, t => Assert.True(Parse(t.CreatedAt) >= new DateTime(2025, 10, 1)));
    }

    [Fact]
    public async Task Only_to_date_filters_upper_bound()
    {
        var result = await Search(new TaskFilter { CreatedTo = "2025-07-01T00:00:00" });
        Assert.NotEmpty(result.Items);
        Assert.All(result.Items, t => Assert.True(Parse(t.CreatedAt) <= new DateTime(2025, 7, 1)));
    }

    [Fact]
    public async Task From_later_than_to_gives_nothing()
    {
        var count = await _repo.CountAsync(new TaskFilter { CreatedFrom = "2025-10-10T00:00:00", CreatedTo = "2025-10-01T00:00:00" }, default);
        Assert.Equal(0, count);
    }

    [Fact]
    public async Task Not_handled_returns_only_tasks_without_handler()
    {
        var result = await Search(new TaskFilter { NotHandled = true });
        Assert.NotEmpty(result.Items);
        Assert.All(result.Items, t => Assert.Null(t.HandledByName));
    }

    [Fact]
    public async Task Ids_filter_returns_exact_tasks()
    {
        var some = (await Search(new TaskFilter())).Items.Take(3).Select(t => t.Id).ToArray();
        var result = await Search(new TaskFilter { Ids = some });
        Assert.Equal(some.Order(), result.Items.Select(t => t.Id).Order());
    }

    [Fact]
    public async Task Workflow_id_contains_is_case_insensitive()
    {
        var result = await Search(new TaskFilter { WorkflowId = "zap-4000" });
        Assert.NotEmpty(result.Items);
        Assert.All(result.Items, t => Assert.Contains("ZAP-4000", t.WorkflowId));
    }

    [Fact]
    public async Task Sorting_by_workflow_ascending()
    {
        var ids = (await Search(new TaskFilter { WorkflowId = "ZAP-4000" }, "workflowId", "asc")).Items.Select(t => t.WorkflowId).ToList();
        Assert.Equal(ids.Order(StringComparer.Ordinal), ids);
    }

    [Fact]
    public async Task Paging_returns_requested_slice()
    {
        var page1 = await _repo.SearchAsync(new TaskSearchRequest { Page = 1, PageSize = 10 }, default);
        var page2 = await _repo.SearchAsync(new TaskSearchRequest { Page = 2, PageSize = 10 }, default);
        Assert.Equal(10, page1.Items.Count);
        Assert.Empty(page1.Items.Select(t => t.Id).Intersect(page2.Items.Select(t => t.Id)));
        Assert.Equal(page1.Total, page2.Total);
    }

    [Fact]
    public async Task Scan_honours_max_bulk_results()
    {
        var repo = new SampleTaskRepository(Options.Create(new ElasticsearchOptions { MaxBulkResults = 25 }));
        var count = 0;
        await foreach (var _ in repo.ScanAsync(new TaskFilter(), null, null, default)) count++;
        Assert.Equal(25, count);
    }

    [Fact]
    public async Task Facets_are_sorted_and_counted()
    {
        var facets = await _repo.FacetsAsync(default);
        Assert.NotEmpty(facets.ProcessNames);
        Assert.Equal(facets.ProcessNames.Select(f => f.Value).Order(), facets.ProcessNames.Select(f => f.Value));
        Assert.All(facets.ProcessNames, f => Assert.True(f.Count > 0));
    }
}
