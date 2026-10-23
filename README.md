# LALIGA Fantasy — Explorador y panel privado

Aplicación web para explorar los datos de **LALIGA Fantasy** y gestionar tu cuenta desde un panel propio: buscador de jugadores, estadísticas por jornada, comparador, calendario, mercado, analizador de cláusulas, alineación y recompensa diaria. Es una web estática (un solo `index.html`) con tres funciones Node.js desplegadas en Vercel.

Demo: https://laguia-fantasy-xi-eight.vercel.app/

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

## Inicio de sesión con Google

Usa **Authorization Code + PKCE** contra el B2C de LALIGA. No se pide ni se guarda ninguna contraseña, y los tokens viven en cookies `HttpOnly` que el JavaScript de la página no puede leer.

> **¡No inicies sesión por teléfono!** Al hacerlo se abre la app oficial de LALIGA Fantasy y el flujo se interrumpe. La web muestra este aviso cada vez que abres la ventana de login. Inicia sesión desde un ordenador.

**Sesión y renovación.** Tras el primer login la sesión se renueva sola con el refresh token mientras uses la web (cookie de renovación de unos 30 días que se renueva cada vez). Si pasas más tiempo sin entrar del que dura ese token, hay que repetir el login. Los pasos de copiar la redirección no se pueden evitar: el cliente de LALIGA solo acepta `authredirect://` como destino.

## Recompensa diaria

El botón **Recoger monedas** reclama la recompensa directamente desde la web. El flujo sigue este orden: **comprobar → cobrar → parar**.

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

## Limitaciones conocidas

- La API es privada y no documentada: cualquier ruta, campo o regla puede cambiar. Las rutas de usuario, ligas, clasificación y plantillas están comprobadas con cuenta real; mercado, movimientos y alineación conviene seguir verificándolos.
- Si tu cuenta no tiene una formación premium, LALIGA puede rechazar el guardado de la alineación.
- El login manual no se puede automatizar sin que LALIGA acepte otro destino de redirección.
- La titularidad depende de un tercero sin API oficial.
- Con un 401 de LALIGA, vuelve a iniciar sesión.

## Solución de problemas

| Síntoma | Qué hacer |
|---|---|
| «Equipo no indicado» en una ficha | Recarga la lista de equipos; si persiste, abre «JSON original» y revisa qué campo de equipo trae. |
| «No disponible ahora mismo» en la titularidad | Abre `/api/titularidad` y mira el error: suele ser que futbolfantasy.com cambió su HTML o no respondió. |

## Aviso legal

Proyecto personal con fines educativos. «LALIGA», «LALIGA Fantasy» y «futbolfantasy.com» pertenecen a sus respectivos propietarios. El autor no garantiza el funcionamiento ni se responsabiliza del uso de la cuenta, de operaciones con dinero del juego ni del cumplimiento de las condiciones de los servicios de terceros.
