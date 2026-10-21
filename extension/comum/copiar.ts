// No iframe da Kentro o navigator.clipboard pode ser recusado: cai para a seleção de texto.
function viaSelecao(texto: string): boolean {
  const area = document.createElement('textarea');
  area.setAttribute('readonly', 'readonly');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.value = texto;
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

export async function copiar(texto: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      return viaSelecao(texto);
    }
  }
  return viaSelecao(texto);
}
