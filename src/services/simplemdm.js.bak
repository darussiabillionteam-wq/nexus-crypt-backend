// ============================================================
// SERVIÇO SIMPLEMDM — Integração com API do SimpleMDM
// ============================================================
import fetch from 'node-fetch';

const SIMPLEMDM_API_KEY = process.env.SIMPLEMDM_API_KEY || 'fByf7YlSLb7nbq37a1xnHyHDbVXRzISY5qzTpR65DvEj6Iws2fmpKWXU1QvuW7bI';
const SIMPLEMDM_BASE_URL = 'https://a.simplemdm.com/api/v1';

const authHeader = 'Basic ' + Buffer.from(SIMPLEMDM_API_KEY + ':').toString('base64');

async function chamarSimpleMDM(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    options.body = '{}';
  }

  try {
    const response = await fetch(`${SIMPLEMDM_BASE_URL}${endpoint}`, options);
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    console.error('[SimpleMDM] Erro:', error);
    return { ok: false, status: 500, data: { error: error.message } };
  }
}

export async function listarDispositivos() {
  return chamarSimpleMDM('/devices', 'GET');
}

export async function buscarDispositivo(simplemdmId) {
  return chamarSimpleMDM(`/devices/${simplemdmId}`, 'GET');
}

export async function bloquearDispositivo(simplemdmId, message = null, phone = null) {
  const body = {};
  if (message) body.message = message;
  if (phone) body.phone_number = phone;
  return chamarSimpleMDM(`/devices/${simplemdmId}/lock`, 'POST', body);
}

export async function apagarDispositivo(simplemdmId) {
  return chamarSimpleMDM(`/devices/${simplemdmId}/wipe`, 'POST', {});
}

export async function reiniciarDispositivo(simplemdmId) {
  return chamarSimpleMDM(`/devices/${simplemdmId}/restart`, 'POST', {});
}

export async function localizarDispositivo(simplemdmId) {
  return chamarSimpleMDM(`/devices/${simplemdmId}/lost_mode/update_location`, 'POST', {});
}

export async function ativarLostMode(simplemdmId, message, phone) {
  return chamarSimpleMDM(`/devices/${simplemdmId}/lost_mode`, 'POST', {
    message,
    phone_number: phone,
  });
}

export async function desativarLostMode(simplemdmId) {
  return chamarSimpleMDM(`/devices/${simplemdmId}/lost_mode`, 'DELETE');
}

export async function enviarMensagem(simplemdmId, message) {
  return chamarSimpleMDM(`/devices/${simplemdmId}/push_message`, 'POST', { message });
}

export default {
  listarDispositivos,
  buscarDispositivo,
  bloquearDispositivo,
  apagarDispositivo,
  reiniciarDispositivo,
  localizarDispositivo,
  ativarLostMode,
  desativarLostMode,
  enviarMensagem,
};