import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'purchaseData.json');

export async function loadPurchaseData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    console.error('Error leyendo purchaseData:', error);
    return {};
  }
}

export async function savePurchaseData(data) {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error guardando purchaseData:', error);
  }
}

export async function addPurchaseRecord(preferenceId, data) {
  const allData = await loadPurchaseData();
  allData[preferenceId] = {
    ...data,
    timestamp: new Date().toISOString(),
  };
  await savePurchaseData(allData);
}

export async function getPurchaseRecord(preferenceId) {
  const allData = await loadPurchaseData();
  return allData[preferenceId] || null;
}

export async function updatePurchaseStatus(preferenceId, status) {
  const allData = await loadPurchaseData();
  if (allData[preferenceId]) {
    allData[preferenceId].status = status;
    await savePurchaseData(allData);
  }
}

export async function cleanOldRecords() {
  const allData = await loadPurchaseData();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const cleanedData = {};
  for (const [key, value] of Object.entries(allData)) {
    const recordDate = new Date(value.timestamp);
    // Compras aprobadas: mantener 7 días
    // Compras pendientes: mantener solo 1 día
    const keepUntil = value.status === 'approved' ? sevenDaysAgo : oneDayAgo;
    if (recordDate > keepUntil) {
      cleanedData[key] = value;
    }
  }
  
  await savePurchaseData(cleanedData);
  console.log(`Limpiados ${Object.keys(allData).length - Object.keys(cleanedData).length} registros antiguos`);
}
