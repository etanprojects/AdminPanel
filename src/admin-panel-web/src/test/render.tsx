import { MantineProvider } from '@mantine/core'
import { render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'

const Providers = ({ children }: { children: ReactNode }) => <MantineProvider env="test">{children}</MantineProvider>

export function renderWithMantine(ui: ReactElement) {
  return render(ui, { wrapper: Providers })
}
