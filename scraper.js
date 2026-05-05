const puppeteer = require('puppeteer');
const fs = require('fs');

const URLS = {
  clasificacion: 'https://www.ffcm.es/pnfg/NPcd/NFG_VisClasificacion?cod_primaria=1000120&codgrupo=22229516&codcompeticion=22229394&',
  partidos: 'https://www.ffcm.es/pnfg/NPcd/NFG_VisCompeticiones_Grupo?cod_primaria=1000123&codequipo=33055&codgrupo=22229516',
};

async function main() {
  console.log('Iniciando Puppeteer...');

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
  );

  // ── Clasificación ──
  await page.goto('https://www.ffcm.es', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  await page.goto(URLS.clasificacion, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  const clasificacion = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('table tr'))
      .map(row =>
        Array.from(row.querySelectorAll('td, th')).map(cell =>
          cell.innerText.trim()
        )
      )
      .filter(row => row.length > 0);
  });

  const filas = clasificacion.slice(2).filter(row => row[1] && row[2]);

  const posicionCds = filas.find(
    row => row[2] && row[2].includes('SIGÜENZA')
  );

  const clasificacionLimpia = filas
    .filter(row => /^\d+$/.test(row[1]))
    .slice(0, 16)
    .map(row => ({
      posicion: row[1],
      equipo: row[2],
      puntos_por_partido: row[3],
      puntos: row[4],
      partidos_jugados: row[5],
      es_cds: row[2].includes('SIGÜENZA'),
    }));

  // ── Partidos ──
  await page.goto(URLS.partidos, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  const partidos = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('table tr'))
      .map(row =>
        Array.from(row.querySelectorAll('td, th')).map(cell =>
          cell.innerText.trim()
        )
      )
      .filter(row => row.length > 0);
  });

  const filaPartidos = partidos.filter(
    row => row.length === 3 && /^\d+$/.test(row[0])
  );

  const jugados = filaPartidos.filter(row => /\d+\s*-\s*\d+/.test(row[2]));

  const proximos = filaPartidos.filter(
    row => row[2] === '-' || row[2].trim() === ''
  );

  function parsearPartido(row) {
    if (!row) return null;

    const partes = row[1].split('\n');
    const fechaHora = partes[2]?.trim() || '';

    const fecha = fechaHora.split('  ')[0]?.trim() || null;
    const hora = fechaHora.split('  ')[1]?.trim() || null;

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

    const partes = row[1].split('\n');
    const fechaHora = partes[2]?.trim() || '';
    const marcadorMatch = row[2].match(/(\d+)\s*-\s*(\d+)/);

    return {
      jornada: row[0],
      local: partes[0]?.trim() || '',
      visitante: partes[1]?.trim() || '',
      fecha: fechaHora.split('  ')[0]?.trim() || null,
      hora: fechaHora.split('  ')[1]?.trim() || null,
      golesLocal: marcadorMatch ? marcadorMatch[1] : '?',
      golesVisitante: marcadorMatch ? marcadorMatch[2] : '?',
    };
  }

  const result = {
    updated: new Date().toISOString(),

    clasificacion: clasificacionLimpia,

    posicion_cds: posicionCds
      ? {
          posicion: posicionCds[1],
          puntos_por_partido: posicionCds[3],
          puntos: posicionCds[4],
          partidos_jugados: posicionCds[5],
        }
      : null,

    proximo_partido: parsearPartido(proximos[0]),
    proximos_partidos: proximos.slice(1, 5).map(parsearPartido),

    ultimo_resultado: parsearResultado(jugados[jugados.length - 1]),
    ultimos_resultados: jugados.slice(-5, -1).reverse().map(parsearResultado),
  };

  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/ffcm.json', JSON.stringify(result, null, 2));

  console.log('Guardado en data/ffcm.json');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

main().catch(error => {
  console.error('Error en el scraper:', error);
  process.exit(1);
});
