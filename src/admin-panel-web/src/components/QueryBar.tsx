import { ActionIcon, Badge, Button, Group, TextInput, Tooltip } from '@mantine/core'
import { memo, useEffect, useState } from 'react'
import { IconChevronDown, IconChevronUp, IconFilter, IconFilterOff, IconHelp, IconSearch } from '../icons'

interface Props {
  query: string
  onSearch: (query: string) => void
  filtersOpen: boolean
  onToggleFilters: () => void
  activeFilters: number
  onClear: () => void
}

export const QueryBar = memo(function QueryBar({ query, onSearch, filtersOpen, onToggleFilters, activeFilters, onClear }: Props) {
  const [input, setInput] = useState(query)
  useEffect(() => setInput(query), [query])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSearch(input)
      }}
    >
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
          label="Query string"
          placeholder='np. keywords:"XXVIII C 11648/21" AND state:2001   (* = wszystkie zadania)'
          leftSection={<IconSearch size={16} />}
          rightSectionPointerEvents="all"
          rightSection={
            <Tooltip
              multiline
              w={420}
              label={
                <>
                  Składnia Elasticsearch query_string, domyślnie AND. Przykłady:
                  <br />• * (wszystkie zadania)
                  <br />• ZAP-40401
                  <br />• keywords:"Irena Głowienka"
                  <br />• participants:PZ007385 AND NOT handledBy:PZ007385
                  <br />• slots.s0.stringValue:73370
                </>
              }
            >
              <IconHelp size={16} style={{ cursor: 'help' }} />
            </Tooltip>
          }
          classNames={{ input: 'mono' }}
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
        />
        <Button type="submit" leftSection={<IconSearch size={16} />}>
          Szukaj
        </Button>
        <Button
          type="button"
          variant={filtersOpen ? 'light' : 'default'}
          leftSection={<IconFilter size={16} />}
          rightSection={
            <Group gap={6} wrap="nowrap">
              {activeFilters > 0 && (
                <Badge size="sm" circle>
                  {activeFilters}
                </Badge>
              )}
              {filtersOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            </Group>
          }
          onClick={onToggleFilters}
        >
          Filtry
        </Button>
        <Tooltip label="Wyczyść wszystkie filtry">
          <ActionIcon
            type="button"
            size="lg"
            variant="default"
            disabled={activeFilters === 0 && !query && !input}
            onClick={() => {
              setInput('')
              onClear()
            }}
            aria-label="Wyczyść wszystkie filtry"
          >
            <IconFilterOff size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </form>
  )
})
