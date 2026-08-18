const puppeteer = require('puppeteer');
const fs = require('fs');

const TEAM_NAME = 'SIGÜENZA';
const EXPECTED_TEAMS = 18;

const URLS = {
  clasificacion: 'https://www.ffcm.es/pnfg/NPcd/NFG_VisClasificacion?cod_primaria=1000120&codgrupo=22916195&codcompeticion=22916193',
  partidos: 'https://www.ffcm.es/pnfg/NPcd/NFG_VisCompeticiones_Grupo?cod_primaria=1000123&codequipo=33055&codgrupo=22916195',
};

function parsearFechaHora(raw) {
  const texto = String(raw || '').replace(/\u00a0/g, ' ').trim();
  const match = texto.match(/^(\d{2}-\d{2}-\d{4})(?:\s+(\d{1,2}:\d{2}))?/);

  return {
    fecha: match?.[1] || null,
    hora: match?.[2] || null,
  };
}

function fechaComparable(raw) {
  const { fecha } = parsearFechaHora(raw);
  if (!fecha) return null;

  const [dia, mes, anio] = fecha.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

function parsearPartido(row) {
  if (!row) return null;
  const partes = row[1].split('\n');
  const { fecha, hora } = parsearFechaHora(partes[2]);

  return {
    jornada: row[0],
    local: partes[0]?.trim() || '',
    visitante: partes[1]?.trim() || '',
    fecha,
    hora,
  };
}

function parsearResultado(row) {
  if (!row) return null;
  const partido = parsearPartido(row);
  const marcador = row[2].match(/(\d+)\s*-\s*(\d+)/);

  return {
    ...partido,
    golesLocal: marcador?.[1] || null,
    golesVisitante: marcador?.[2] || null,
  };
}

async function leerTabla(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  return page.evaluate(() => Array.from(document.querySelectorAll('table tr'))
    .map(row => Array.from(row.querySelectorAll('td, th')).map(cell => cell.innerText.trim()))
    .filter(row => row.length > 0));
}

async function main() {
  console.log('Iniciando Puppeteer...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36');

    // La primera visita establece las cookies que necesita la web de la FFCM.
    await page.goto('https://www.ffcm.es', { waitUntil: 'networkidle2', timeout: 30000 });

    const clasificacion = await leerTabla(page, URLS.clasificacion);
    const filas = clasificacion
      .slice(2)
      .filter(row => /^\d+$/.test(row[1]) && row[2]);

    const clasificacionLimpia = filas.slice(0, EXPECTED_TEAMS).map(row => ({
      posicion: row[1],
      equipo: row[2],
      puntos_por_partido: row[3],
      puntos: row[4],
      partidos_jugados: row[5],
      es_cds: row[2].includes(TEAM_NAME),
    }));

    const posicionCds = filas.find(row => row[2].includes(TEAM_NAME));

    if (clasificacionLimpia.length !== EXPECTED_TEAMS || !posicionCds) {
      throw new Error(`Clasificación inválida: ${clasificacionLimpia.length}/${EXPECTED_TEAMS} equipos; Sigüenza encontrado: ${!!posicionCds}`);
    }

    const partidos = await leerTabla(page, URLS.partidos);
    const filasPartidos = partidos.filter(row => row.length === 3 && /^\d+$/.test(row[0]));
    const jugados = filasPartidos.filter(row => /\d+\s*-\s*\d+/.test(row[2]));

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const sinResultado = filasPartidos.filter(row => ['-', ''].includes(row[2].trim()));
    const proximos = sinResultado.filter(row => {
      const fecha = fechaComparable(row[1].split('\n')[2]);
      return !fecha || fecha >= hoy;
    });
    const suspendidos = sinResultado.filter(row => {
      const fecha = fechaComparable(row[1].split('\n')[2]);
      return fecha && fecha < hoy;
    });

    if (filasPartidos.length === 0) {
      throw new Error('La FFCM no devolvió partidos para el CD Sigüenza');
    }

    const result = {
      temporada: '2026/27',
      competicion: 'Primera Autonómica Preferente',
      grupo: 2,
      updated: new Date().toISOString(),
      clasificacion: clasificacionLimpia,
      posicion_cds: {
        posicion: posicionCds[1],
        puntos_por_partido: posicionCds[3],
        puntos: posicionCds[4],
        partidos_jugados: posicionCds[5],
      },
      proximo_partido: parsearPartido(proximos[0]),
      partido_suspendido: parsearPartido(suspendidos.at(-1)),
      proximos_partidos: proximos.slice(1, 5).map(parsearPartido),
      ultimo_resultado: parsearResultado(jugados.at(-1)),
      ultimos_resultados: jugados.slice(-5, -1).reverse().map(parsearResultado),
    };

    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync('data/ffcm.json', JSON.stringify(result, null, 2));

    console.log('Guardado en data/ffcm.json');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('Error en el scraper:', error);
  process.exit(1);
});
