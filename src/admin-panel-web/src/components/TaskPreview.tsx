import { Alert, Code, Drawer, ScrollArea, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { TaskDto } from '../types'

export function TaskPreview({ task, onClose }: { task: TaskDto; onClose: () => void }) {
  const [raw, setRaw] = useState<unknown>()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setRaw(undefined)
    setError(null)
    api
      .raw(task.id)
      .then((r) => active && setRaw(r))
      .catch((e) => active && setError(e.message))
    return () => {
      active = false
    }
  }, [task.id])

  return (
    <Drawer
      opened
      onClose={onClose}
      position="right"
      size="xl"
      title={<Text fw={600}>Zadanie {task.workflowId}</Text>}
      scrollAreaComponent={ScrollArea.Autosize}
    >
      {error && <Alert color="red">{error}</Alert>}
      {!error && (
        <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {raw ? JSON.stringify(raw, null, 2) : 'Ładowanie…'}
        </Code>
      )}
    </Drawer>
  )
}
