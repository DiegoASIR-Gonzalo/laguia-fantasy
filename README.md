# LALIGA Fantasy — Explorador y panel privado

Aplicación web para explorar los datos de **LALIGA Fantasy** y gestionar tu cuenta desde un panel propio: buscador de jugadores, estadísticas por jornada, comparador, calendario, mercado, analizador de cláusulas, alineación y recompensa diaria. Es una web estática (un solo `index.html`) con tres funciones Node.js desplegadas en Vercel.

Demo: https://fantasy-xi-eight.vercel.app/

> **Proyecto no oficial.** No está afiliado a LALIGA ni a futbolfantasy.com. Usa la API privada de la app móvil de LALIGA Fantasy, que no está documentada y puede cambiar sin aviso. Úsalo solo con tu propia cuenta.

---

## Qué incluye

| Sección | Qué hace | Sesión |
|---|---|---|
| **Inicio** | Buscador instantáneo de jugadores (nombre, apodo, equipo o ID) y ranking de mejores jugadores por puntos o por titularidad. | No |
| **Equipos** | Tarjetas de los clubes y sus plantillas, con opciones de ordenación. | No |
| **Mis Ligas** | Tus ligas con seis pestañas: Clasificación, Equipos y plantillas, Mercado, Analizador de cláusulas, Cláusulas bloqueadas y Movimientos. | Sí |
| **Calendario** | Partidos de cada jornada ordenados por fecha. | No |
| **Mi Alineación** | Editor del once titular real: elige liga, formación y los 11 puestos. | Sí |
| **Olvidados** | Jugadores marcados como `out_of_league`, que no aparecen en el resto de la web. | No |
| **Comparador** | Compara minutos, puntos y regularidad positiva de varios jugadores. | No |
| **Explorador API** | Herramientas para consultar los endpoints públicos. | No |

### Ficha del jugador

Al abrir un jugador se muestra una ventana con cuatro pestañas: **Resumen**, **Por jornadas**, **Más datos** y **JSON original**.

- **Estadísticas por jornada.** Una tira de jornadas con los puntos en verde o rojo y, debajo, el detalle de la jornada elegida agrupado por categorías (Participación, Portería, Disciplina y errores, Ataque, Pases y balón, Defensa y Otros). Cada fila muestra el valor y los puntos que aporta, y cada categoría su subtotal. Se navega con las flechas ← →.
- **Titularidad de la próxima jornada.** Un recuadro junto a Puntos, Media y Valor de mercado indica el porcentaje de probabilidad de ser titular, el rival y si juega en casa o fuera. Verde desde el 75 %, ámbar del 40 al 74 % y rojo por debajo del 40 %.
- **Equipo.** Si la ficha no trae el nombre del club, se resuelve con la lista maestra de equipos de LALIGA.

### Mis Ligas

- **Analizador de cláusulas:** todos los jugadores de otros managers cuya cláusula puedes pagar ahora (no incluye tu equipo ni las cláusulas bloqueadas).
- **Cláusulas bloqueadas:** jugadores con la cláusula bloqueada y el día y la hora en que termina el bloqueo.
- Ambas pestañas se pueden **ordenar**, **buscar** por jugador o manager y **filtrar por posición** (Todas, Porteros, Defensas, Medios, Delanteros, con el número de jugadores de cada una).
- **Mercado:** consulta, puja y pago de cláusula, con saldo y movimientos.
- **Recompensa diaria:** ver más abajo.

### Interfaz

Tema oscuro y plano, responsive, con barra de navegación inferior en móvil. Las ventanas, fichas y listas aparecen con transiciones suaves; si el sistema tiene activado el movimiento reducido, se desactivan.

---

## Arquitectura

```
Navegador ──► /api/laliga       ──► fantasy-api.llt-services.com        (lectura pública, lista permitida)
          ├─► /api/auth         ──► login.laliga.es + fantasy-api…      (sesión, lecturas y escrituras privadas)
          └─► /api/titularidad  ──► futbolfantasy.com + fantasy-api…    (probabilidad de titularidad)
```

```
.
├── index.html            Aplicación completa (HTML, CSS y JavaScript sin dependencias ni build)
├── api/
│   ├── laliga.js         Proxy de solo lectura para los endpoints públicos
│   ├── auth.js           Inicio de sesión OAuth, proxy privado de lectura y escritura con confirmación
│   └── titularidad.js    Lee las probabilidades de futbolfantasy.com y las empareja con los jugadores
├── vercel.json           Duración máxima (30 s) de las tres funciones
└── README.md
```

No hay `package.json`, dependencias ni variables de entorno: las funciones solo usan `fetch` y `crypto` de Node (se requiere Node 18 o superior, que Vercel ya ofrece).

### Funciones

| Función | Método | Qué hace |
|---|---|---|
| `/api/laliga?path=…` | GET | Reenvía a la API de LALIGA solo las rutas de la lista permitida pública. |
| `/api/auth?provider=google` | GET | Inicia el flujo OAuth y redirige al login oficial. |
| `/api/auth` | GET / POST / DELETE | Estado de sesión, canje del código de login y cierre de sesión. |
| `/api/auth?path=…` | GET / POST | Lecturas privadas y escrituras con confirmación (ver Seguridad). |
| `/api/titularidad` | GET | Devuelve `{ players: { "<idLaLiga>": { p, w, rival, home } } }`. |

---

## Despliegue

1. Importa el repositorio en Vercel.
2. No hace falta comando de build ni variables de entorno.
3. Despliega y abre la URL que te da Vercel.

Para probarlo en local puedes usar la CLI de Vercel (`npx vercel dev`). Las cookies de sesión son `Secure`, así que el login completo solo es fiable sobre HTTPS.

---

## Inicio de sesión con Google

Usa **Authorization Code + PKCE** contra el B2C de LALIGA. No se pide ni se guarda ninguna contraseña, y los tokens viven en cookies `HttpOnly` que el JavaScript de la página no puede leer.

> **¡No inicies sesión por teléfono!** Al hacerlo se abre la app oficial de LALIGA Fantasy y el flujo se interrumpe. La web muestra este aviso cada vez que abres la ventana de login. Inicia sesión desde un ordenador.

1. Abre las **herramientas de desarrollador** (F12), ve a **Red / Network** y activa **Conservar registro / Preserve log**. Hazlo *antes* de iniciar sesión para que la redirección no se pierda.
2. Pulsa **Iniciar sesión → Continuar con Google** y completa el acceso en la página oficial.
3. Al terminar, busca en Network la última petición, que empieza por `authredirect://com.lfp.laligafantasy` y suele aparecer como cancelada.
4. Copia su URL completa (o el valor de `Location` de las cabeceras) y pégala en el formulario con **Completar login**.
5. El servidor comprueba el `state`, canjea el código con el `code_verifier` original y verifica la cuenta con `GET /v4/user/me`.

La URL contiene un código de un solo uso: no la publiques ni la compartas. Si caduca o falla, empieza de nuevo desde el paso 2.

**Sesión y renovación.** Tras el primer login la sesión se renueva sola con el refresh token mientras uses la web (cookie de renovación de unos 30 días que se renueva cada vez). Si pasas más tiempo sin entrar del que dura ese token, hay que repetir el login. Los pasos de copiar la redirección no se pueden evitar: el cliente de LALIGA solo acepta `authredirect://` como destino.

| Cookie | Contenido | Duración |
|---|---|---|
| `lf_session` | Token de acceso | El que indique el token (~24 h) |
| `lf_refresh` | Token de renovación | ~30 días, renovado en cada uso |
| `lf_oauth_state`, `lf_oauth_verifier`, `lf_oauth_nonce` | Datos temporales del login | 15 min |

Todas son `Secure; HttpOnly; SameSite=Strict` (las temporales, `Lax`) con ámbito `/api/auth`.

---

## Recompensa diaria

El botón **Recoger monedas** reclama la recompensa directamente desde la web. El flujo sigue este orden: **comprobar → cobrar → parar**.

1. `GET /v1/competition/1/daily-reward` — catálogo con el importe y el límite diario (`dailyLimit`, actualmente 2 al día; si no responde se asume 2).
2. `GET /v1/competition/1/league/{liga}/team/{equipo}/check-daily-reward` — devuelve `dailyRewardsRedeemed`. Un `400` con `errorCode 050.01.04` («Team daily reward limit reached») **no es un error**: significa que ya está cobrada y es la señal de parar.
3. `POST /v1/competition/1/league/{liga}/team/daily-reward` — se envía una vez por cada recompensa pendiente (límite menos cobradas), con el cuerpo `{"rewardedAdType":"dailyreward","rewardedAd":1,"teamId":"<id como texto>"}`.

Detalles que importan:

- La ruta usa `league/team` **en singular** y no lleva el `teamId` en la URL; el `teamId` va como texto en el cuerpo. `rewardedAd: 1` es solo una marca que la API no verifica; LALIGA podría empezar a exigir la prueba del anuncio en cualquier momento.
- Importes: 100.000 € (estándar) o 200.000 € (premium) por liga y día, con eventos de 500.000 € o 1.000.000 €. Se reinicia a medianoche, hora de Madrid.
- El POST no devuelve el importe, así que la web consulta tu saldo (`GET …/teams/{teamId}/money`) antes y después y muestra la diferencia.
- Se pide **una sola confirmación** para todos los cobros de esa pulsación; el servidor sigue exigiendo preparar y confirmar cada petición.

---

## Titularidad (futbolfantasy.com)

`futbolfantasy.com` no ofrece API, así que `api/titularidad.js` lee el HTML de su página de mercado de LaLiga Fantasy, extrae por jugador la probabilidad de titularidad, la jornada y el rival, y lo empareja con los jugadores de LALIGA.

- **Emparejamiento.** Los nombres y los identificadores de equipo son distintos en cada fuente, así que se cruzan por nombre normalizado en pasadas de más estricto a más laxo (nombre exacto, mismas palabras, abreviaturas como «fdez», variantes de apodo y similitud aproximada). Solo se confirma una pareja cuando es inequívoca en ambos sentidos, de modo que «Raúl» no se queda con «Raúl Moro».
- **Caché.** La respuesta se guarda 15 minutos en el CDN de Vercel (y otros 15 en memoria en el navegador) para no sobrecargar el servidor de terceros.
- **Fragilidad.** Depende del HTML de futbolfantasy.com: si cambian su formato, el recuadro mostrará «No disponible ahora mismo». Comprueba también sus condiciones de uso antes de dar un uso intensivo.

---

## Seguridad

- **Listas permitidas.** El proxy público y el privado solo reenvían rutas de listas cerradas, con lectura y escritura separadas. Cualquier otra ruta responde 403.
- **Escrituras en dos fases.** Toda escritura exige primero *preparar* (el servidor valida ruta y cuerpo y devuelve un ticket firmado con HMAC, válido 90 segundos) y luego *confirmar* con exactamente la misma ruta, método y contenido. Nada se envía a LALIGA sin esa segunda petición.
- **Validación estricta de cuerpos.** Pujas y pagos de cláusula solo aceptan un importe entero positivo; la alineación debe tener 11 fichas distintas y una formación permitida; la recompensa diaria solo acepta el cuerpo exacto descrito arriba.
- **Origen.** Las peticiones POST y DELETE de `/api/auth` solo se aceptan desde el mismo origen.
- **Sin acciones automáticas.** Pujas, pagos, alineaciones y recompensas necesitan siempre una confirmación del usuario.
- **Datos sensibles.** Los tokens nunca llegan al JavaScript del navegador y no se guardan en ningún almacenamiento. Lo único que se guarda en `localStorage` es una caché de la lista de equipos (`lf_teams_cache_v1`).

---

## Endpoints

### Públicos (`/api/laliga`)

| Ruta |
|---|
| `/v3/teams-master` |
| `/v1/competition/1/players` |
| `/v1/competition/1/player/{id}` |
| `/v1/competition/1/player/{id}/market-value` |
| `/v1/competition/1/week/current` |
| `/v1/competition/1/calendar` |
| `/stats/v1/competition/1/stats/week/{semana}` |

### Privados de lectura (`/api/auth?path=…`)

Usuario (`/v4/user/me`), ligas, clasificación, equipos de una liga, movimientos, dinero, alineación actual y por jornada, mercado, ofertas, ficha de un jugador en una liga, escudo de cláusula (`check-shield`), `check-daily-reward` y el catálogo `daily-reward`.

### Privados de escritura

| Operación | Ruta |
|---|---|
| Pujar | `POST /v1/competition/1/league/{liga}/market/{mercado}/bid` |
| Pagar cláusula | `POST /v1/competition/1/league/{liga}/buyout/{playerTeam}/pay` |
| Guardar alineación | `PUT /v1/competition/1/teams/{equipo}/lineup` |
| Recompensa diaria | `POST /v1/competition/1/league/{liga}/team/daily-reward` |

Las acciones con dinero son definitivas: revisa jugador, liga, importe y saldo antes de confirmar. Si una respuesta no confirma el éxito, actualiza mercado, saldo o plantilla antes de reintentar; no repitas la operación a ciegas.

---

## Limitaciones conocidas

- La API es privada y no documentada: cualquier ruta, campo o regla puede cambiar. Las rutas de usuario, ligas, clasificación y plantillas están comprobadas con cuenta real; mercado, movimientos y alineación conviene seguir verificándolos.
- Si tu cuenta no tiene una formación premium, LALIGA puede rechazar el guardado de la alineación.
- El login manual no se puede automatizar sin que LALIGA acepte otro destino de redirección.
- La titularidad depende de un tercero sin API oficial.
- Con un 401 de LALIGA, vuelve a iniciar sesión.

## Solución de problemas

| Síntoma | Qué hacer |
|---|---|
| «La URL parece cortada» o «El código está incompleto» | Copia de nuevo la URL completa desde Network; no uses una fila intermedia (`https://…`), sino la de `authredirect://`. |
| «El state no coincide» | Pega la URL del mismo intento de login, no de uno anterior. |
| El login no aparece en Network | Abre F12 y activa *Preserve log* antes de iniciar sesión. |
| «Equipo no indicado» en una ficha | Recarga la lista de equipos; si persiste, abre «JSON original» y revisa qué campo de equipo trae. |
| «No disponible ahora mismo» en la titularidad | Abre `/api/titularidad` y mira el error: suele ser que futbolfantasy.com cambió su HTML o no respondió. |
| El botón de recompensa no hace nada | Comprueba que tienes la sesión activa y que no estén ya cobradas las recompensas del día. |

## Aviso legal

Proyecto personal con fines educativos. «LALIGA», «LALIGA Fantasy» y «futbolfantasy.com» pertenecen a sus respectivos propietarios. El autor no garantiza el funcionamiento ni se responsabiliza del uso de la cuenta, de operaciones con dinero del juego ni del cumplimiento de las condiciones de los servicios de terceros.
