# Panel administracyjny zadań

Lista zadań z indeksu Elasticsearch `basic_basetask` z filtrami, zaznaczaniem i eksportem CSV. Główna funkcja to masowe
uruchamianie akcji (np. `finish-as-administrator`) na zaznaczonych zadaniach, z postępem wysyłanym przez WebSocket.

- **Backend**: .NET 10, kontrolery ASP.NET Core, SignalR, JWT Bearer (OIDC). Elasticsearch przez REST (ES 7.10+ / 8.x).
- **Frontend**: React 19 + Vite 6 + Mantine 9, `oidc-client-ts` (Authorization Code + PKCE), `@microsoft/signalr`,
  `@tanstack/react-virtual`. Wymaga **Node ≥ 20.14** (sprawdzone na 20.14.0). Ikony (Tabler, MIT) są w `src/icons.tsx`,
  bez pakietu `@tabler/icons`. W `.npmrc` są wydłużone timeouty dla sieci firmowej, tam też można ustawić wewnętrzny registry.

## Uruchomienie lokalne (dane przykładowe, bez ES i bez logowania)

```bash
dotnet run --project src/AdminPanel.Api --launch-profile http
```

```bash
npm --prefix src/admin-panel-web run dev
```

Otwórz http://localhost:5173. `appsettings.Development.json` włącza `UseSampleData` (12 000 losowych zadań), wyłącza logowanie
i wskazuje akcje na wbudowany mock (`/mock/...`), który losowo zwraca błędy 404/409/500.

## Build produkcyjny

```bash
npm --prefix src/admin-panel-web run build
```

```bash
dotnet publish src/AdminPanel.Api -c Release -o publish
```

Build SPA trafia do `src/AdminPanel.Api/wwwroot`. SPA, API i hub działają pod jednym originem, więc własny CORS nie jest potrzebny.

### Wdrożenie pod podścieżką (np. `https://serwer/AdminPanel/`)

- **IIS (aplikacja w podkatalogu witryny):** nic nie trzeba konfigurować. IIS ustawia `PathBase`, a backend wstawia go
  do `<base href>` w `index.html`. Frontend używa ścieżek względnych (`assets/`, `api/`, `hubs/`), więc zadziała pod
  dowolną ścieżką.
- **Reverse proxy przekazujący prefiks** (nginx, YARP): ustaw `"PathBase": "/AdminPanel"` w `appsettings.json`.
- **Serwer OIDC:** redirect URI musi zawierać podścieżkę i ukośnik na końcu: `https://serwer/AdminPanel/`.
- **WebSockety na IIS:** włącz funkcję Windows „WebSocket Protocol” (Server Roles → Web Server → Application Development).
  Bez niej SignalR przejdzie na wolniejszy long polling.
- Plik `actions.json` jest szukany w katalogu aplikacji (ContentRoot, a potem katalog z DLL). Jeśli go brakuje, log podaje sprawdzone ścieżki.

## Testy

```bash
dotnet test tests/AdminPanel.Api.Tests
```

```bash
npm --prefix src/admin-panel-web test
```

- **Backend** (xUnit, `tests/AdminPanel.Api.Tests`):
  - budowanie zapytań do Elasticsearch: filtry, zakresy dat od/do, escape'owanie znaków;
  - komunikacja z ES na atrapie HTTP: paginacja, `search_after`, obsługa błędów;
  - akcje: szablony, walidacja parametrów, wykonywanie requestów (autoryzacja, opisy błędów, przerwanie);
  - joby z powiadomieniami SignalR, katalog akcji, CSV.
- **Frontend** (Vitest + Testing Library, pliki `*.test.ts(x)` obok kodu):
  - funkcje pomocnicze i CSV, logika filtrów, klient API;
  - pasek wyszukiwania i tabela;
  - panel akcji: blokady przycisku, wielokrotne przełączanie, postęp, ponowne zaznaczanie błędnych.

## Architektura

```
Przeglądarka ──(Bearer)──▶ AdminPanel.Api ──▶ Elasticsearch (lista, filtry, eksport)
     ▲                         │
     └── WebSocket /hubs/jobs ◀┤ ActionJobManager (job w tle, N równolegle)
                               └──(Bearer użytkownika)──▶ inna.aplikacja/process-instances/...
```

- Requesty do docelowej aplikacji wysyła **backend**, a nie przeglądarka. Dlatego **aplikacja docelowa nie potrzebuje zmian w CORS**.
- Uruchomienie akcji (`POST /api/actions/{key}/jobs`) tworzy job w pamięci serwera. Job działa dalej po zamknięciu karty.
  Wraca się do niego przez „Historia wykonań” (przechowywana 24 h, do restartu aplikacji).
- Postęp idzie przez SignalR (WebSocket): po każdym requeście jest zdarzenie `progress`, na końcu `finished`. Po zerwaniu
  połączenia klient łączy się ponownie, a `Subscribe` zwraca snapshot z brakującymi wynikami.

## Konfiguracja

### `appsettings.json`

| Sekcja | Klucz | Opis |
|---|---|---|
| Elasticsearch | `Url`, `Index`, `Username`/`Password` lub `ApiKey` | połączenie |
| | `Fields` | mapowanie pól do filtrowania i sortowania (domyślnie subpola `.keyword`) |
| | `TimeZone` | strefa, w której są interpretowane daty z filtrów (`time_zone` w range query) |
| | `MaxBulkResults` | limit dla „Zaznacz wszystkie wyniki” i eksportu CSV (lista pokazuje max 10 000) |
| Auth | `Authority`, `ClientId`, `Scope` | serwer OIDC i klient, ten sam `client_id` co w innej aplikacji |
| | `Audience`, `RequiredRole` | opcjonalna walidacja audience i wymagana rola |
| Execution | `ActionsFile`, `DefaultParallelism`, `RequestTimeoutSeconds` | wykonywanie akcji |
| | `ClientCredentials` | token aplikacyjny dla akcji z `"auth": "ClientCredentials"` |

### `actions.json`: typy akcji

Plik przeładowuje się automatycznie po zapisaniu. Nową akcję dodaje się jako kolejny element `actions`:

```jsonc
{
  "key": "finish-as-administrator",
  "name": "Zakończ jako administrator",
  "method": "POST",
  "url": "https://inna.aplikacja/process-instances/finish-as-administrator",
  "auth": "PassThrough",            // PassThrough | ClientCredentials | None
  "parallelism": 4,
  "headers": { "X-Source": "admin-panel" },
  "body": { "id": "{{task.id}}", "isReject": "{{param.isReject}}", "comment": "{{param.comment}}" },
  "parameters": [
    { "name": "isReject", "label": "Odrzuć", "type": "boolean", "default": false },
    { "name": "comment", "label": "Komentarz", "type": "textarea", "required": true }
  ]
}
```

Placeholdery: `{{task.id}}`, `{{task.workflowId}}`, `{{task.instanceId}}`, `{{task.processId}}`, `{{param.X}}`. Jeśli wartość
w body to sam placeholder, zachowuje typ (`true`, liczba). Typy parametrów: `boolean`, `text`, `textarea`, `number`, `select`.

## OIDC i CORS: co trzeba skonfigurować

1. **Serwer OpenID Connect**: w konfiguracji klienta (`client_id`) dodaj:
   - redirect URI i post-logout redirect URI: `https://<adres-panelu>/` (lokalnie `http://localhost:5173/`),
   - **dozwolony CORS origin** `https://<adres-panelu>`. SPA pobiera discovery i wymienia code na token z przeglądarki.
   - Klient musi pozwalać na Authorization Code + PKCE bez sekretu (klient publiczny). Jeśli klient jest poufny
     (wymaga `client_secret`), trzeba przejść na model BFF (logowanie po stronie backendu).
2. **Aplikacja docelowa**: CORS nie jest potrzebny. Musi zaakceptować token użytkownika przekazany przez backend.
   Jeśli sprawdza `aud` lub scope, w `Auth:Scope` dodaj scope tego API.
3. Token użytkownika jest pobierany w chwili startu joba. Jeśli job trwa dłużej niż czas życia tokenu, późniejsze requesty
   dostaną 401. Wtedy użyj „Zaznacz błędne i niewykonane” i uruchom ponownie albo przełącz akcję na `ClientCredentials`.
