import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import './app.css'

import {
  Alert,
  Center,
  Collapse,
  Combobox,
  Drawer,
  Loader,
  MantineProvider,
  Menu,
  Modal,
  Popover,
  Tooltip,
  createTheme,
} from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { Notifications } from '@mantine/notifications'
import dayjs from 'dayjs'
import 'dayjs/locale/pl'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api'
import App from './App'
import { ensureLoggedIn, initAuth } from './auth'

dayjs.locale('pl')

const instant = { transitionProps: { duration: 0 } }
const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'sm',
  fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
  components: {
    Modal: Modal.extend({ defaultProps: instant }),
    Drawer: Drawer.extend({ defaultProps: instant }),
    Menu: Menu.extend({ defaultProps: instant }),
    Popover: Popover.extend({ defaultProps: instant }),
    Tooltip: Tooltip.extend({ defaultProps: { ...instant, openDelay: 300 } }),
    Combobox: Combobox.extend({ defaultProps: instant }),
    Collapse: Collapse.extend({ defaultProps: { transitionDuration: 0 } }),
  },
})

const root = createRoot(document.getElementById('root')!)

function render(content: React.ReactNode) {
  root.render(
    <StrictMode>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <DatesProvider settings={{ locale: 'pl', firstDayOfWeek: 1 }}>
          <Notifications position="bottom-right" autoClose={3000} />
          {content}
        </DatesProvider>
      </MantineProvider>
    </StrictMode>,
  )
}

async function bootstrap() {
  render(
    <Center h="100vh">
      <Loader />
    </Center>,
  )
  try {
    const config = await api.config()
    initAuth(config)
    if (config.auth.enabled) {
      const user = await ensureLoggedIn()
      if (!user) return
    }
    render(<App config={config} />)
  } catch (e) {
    render(
      <Center h="100vh" p="xl">
        <Alert color="red" title="Nie udało się uruchomić aplikacji" maw={600}>
          {e instanceof Error ? e.message : String(e)}
        </Alert>
      </Center>,
    )
  }
}

bootstrap()
