# LALIGA Fantasy — Explorador y panel privado

Aplicación web estática desplegada en Vercel con funciones Node.js. La aplicación conserva los tokens de LALIGA en cookies `HttpOnly`; no los entrega al JavaScript del navegador.

## Despliegue

1. Importa este repositorio en Vercel.
2. No hace falta comando de build.
3. Despliega y abre la URL que proporciona Vercel.

## Explorador público

El buscador público usa una lista permitida de endpoints de lectura a través de `/api/laliga`:

`Navegador → /api/laliga → fantasy-api.llt-services.com/api`

## Inicio de sesión con Google

La autenticación usa Authorization Code + PKCE mediante LALIGA B2C; no pide ni guarda la contraseña de Google o de LALIGA.

1. Pulsa **Continuar con Google** y completa el acceso en la página oficial.
2. En la pestaña de autenticación abre **F12 → Red/Network → Todas** y localiza la redirección `authredirect://com.lfp.laligafantasy`.
3. Copia la cabecera completa `Location` (o la URL completa de la solicitud al esquema personalizado), pégala en el formulario y pulsa **Completar login**.
4. El servidor valida `state`, canjea el código con el `code_verifier` original y verifica la sesión mediante `GET /v4/user/me`.

La URL de redirección contiene un código de un solo uso. No la publiques ni la envíes en chats. Si caduca, vuelve a iniciar el proceso.

## Mis Ligas

La sección **Mis Ligas** permite consultar las ligas de la cuenta, sus clasificaciones y las plantillas de los managers. Incluye vista de mercado, saldo y movimientos.

El mercado dispone de puja y pago de cláusula. Antes de cada escritura el servidor valida la ruta y el cuerpo, prepara un ticket de aprobación de corta duración y requiere una segunda petición confirmada tras mostrar el resumen de la operación. Las rutas de escritura están limitadas a:
- `POST /v1/competition/1/league/{leagueId}/market/{marketId}/bid`
- `POST /v1/competition/1/league/{leagueId}/buyout/{playerTeamId}/pay`
- `PUT /v1/competition/1/teams/{teamId}/lineup`

Las demás rutas de juego no aceptan escrituras a través del proxy. Las acciones con dinero son definitivas: revisa el jugador, liga, importe y saldo antes de confirmar. Si una respuesta no confirma éxito, actualiza mercado, saldo o plantilla antes de volver a intentarlo; no repitas la operación a ciegas.

## Recompensa diaria

Al abrir el detalle de una liga, la interfaz consulta el endpoint de lectura `GET /v1/competition/1/league/{leagueId}/team/{teamId}/check-daily-reward` para reflejar si las monedas del día ya se recogieron. Si ya están recogidas, el botón queda desactivado; si no, aparece **Recoger Monedas**.

La reclamación de LALIGA usa una ruta distinta: `POST /v1/competition/1/league/{leagueId}/team/daily-reward`, con `teamId`, `rewardedAdType` y `rewardedAd`. La API valida una prueba legítima del anuncio recompensado. Esta web no integra actualmente el SDK/proveedor de anuncios ni genera esa prueba, por lo que el botón abre LALIGA Fantasy para completar el anuncio y reclamar allí. Al volver, el mismo botón permite comprobar si la recompensa quedó registrada. No se envían valores falsificados ni se muestra la recompensa como recibida hasta que la API confirme el estado.

## Mi Alineación (antes «Crear Plantilla»)

Esta sección ya no guarda un once de prueba en el navegador. Permite elegir una liga propia, identificar el equipo del usuario, cargar sus fichas y la alineación actual, seleccionar una de las formaciones gratuitas documentadas o una formación premium conocida y editar los 11 puestos. Si tu cuenta no tiene acceso a una formación premium, LALIGA puede rechazar el guardado. El guardado valida que los jugadores pertenezcan a la plantilla, que no se repitan y que sus posiciones coincidan. Antes del `PUT`, muestra un resumen completo y solicita confirmación explícita.

Las rutas de lectura del usuario, ligas, clasificación y plantillas figuran como comprobadas con cuenta real en el documento técnico de referencia. Las rutas de mercado, actividad y alineación deben seguir verificándose contra el servicio real; este repositorio no puede garantizar que una ruta no documentada públicamente permanezca estable.

## Seguridad y límites

- Las cookies de sesión y renovación son `Secure`, `HttpOnly`, con `SameSite` restrictivo y ámbito `/api/auth`.
- El proxy privado valida una lista permitida independiente para lectura y escritura.
- Las escrituras exigen preparar y confirmar exactamente la misma ruta, método y contenido; el ticket caduca en 90 segundos.
- No se activan automáticamente compras, pujas ni cambios de alineación. Cada una necesita una confirmación concreta del usuario.
- La renovación de tokens necesita pruebas periódicas contra LALIGA; si la API responde 401, vuelve a iniciar sesión.

Aplicación: https://fantasy-xi-eight.vercel.app/
