using System.Text.Json;
using AdminPanel.Api.Tasks;

namespace AdminPanel.Api.Tests;

public class TaskDtoTests
{
    [Fact]
    public void Maps_fields_from_elasticsearch_source()
    {
        var source = JsonDocument.Parse("""
            {
              "id": "781c0000-c6ae-56ae-8d7e-08de026b93df",
              "instanceId": "781c0000-c6ae-56ae-8d7e-08de026b93df",
              "processId": "6c270000-5d1d-0015-59fd-08dc23d98d0e",
              "createdAt": "2025-10-03T12:59:40.7566670",
              "updatedAt": "2025-10-17T12:39:24.4682220+02:00",
              "workflowId": "ZAP-40401",
              "processName": "Zapytanie z Departamentu Prawnego do CBO",
              "currentStepName": "Weryfikacja w DPR - pozew bierny",
              "handledBy": "PZ007385",
              "handledByName": "Rosłon Michał (EXT)",
              "state": 2001,
              "status": 0
            }
            """).RootElement;

        var dto = TaskDto.FromSource("doc-id", source);

        Assert.Equal("781c0000-c6ae-56ae-8d7e-08de026b93df", dto.Id);
        Assert.Equal("6c270000-5d1d-0015-59fd-08dc23d98d0e", dto.ProcessId);
        Assert.Equal("2025-10-03T12:59:40.7566670", dto.CreatedAt);
        Assert.Equal("2025-10-17T12:39:24.4682220+02:00", dto.UpdatedAt);
        Assert.Equal("ZAP-40401", dto.WorkflowId);
        Assert.Equal("Weryfikacja w DPR - pozew bierny", dto.CurrentStepName);
        Assert.Equal("Rosłon Michał (EXT)", dto.HandledByName);
        Assert.Equal(2001, dto.State);
        Assert.Equal(0, dto.Status);
    }

    [Fact]
    public void Uses_document_id_and_nulls_for_missing_fields()
    {
        var dto = TaskDto.FromSource("doc-id", JsonDocument.Parse("""{"handledByName":null}""").RootElement);
        Assert.Equal("doc-id", dto.Id);
        Assert.Null(dto.HandledByName);
        Assert.Null(dto.State);
        Assert.Null(dto.WorkflowId);
    }

    [Fact]
    public void Non_string_values_are_kept_as_raw_json()
    {
        var dto = TaskDto.FromSource("d", JsonDocument.Parse("""{"workflowId":40401,"state":"x"}""").RootElement);
        Assert.Equal("40401", dto.WorkflowId);
        Assert.Null(dto.State);
    }
}
