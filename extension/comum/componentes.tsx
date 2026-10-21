import { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { copiar } from './copiar';
import { avisar } from './omni';

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'erro' | 'ok'; children: ComponentChildren }) {
  return (
    <div class={`kt-aviso kt-aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <p class="kt-muted">{texto}</p>;
}

export function BotaoCopiar({ texto, rotulo = 'Copiar', aoCopiar }: { texto: string; rotulo?: string; aoCopiar?: string }) {
  const [falhou, setFalhou] = useState(false);
  return (
    <>
      <button
        type="button"
        class="kt-botao kt-botao-suave"
        onClick={async () => {
          const ok = await copiar(texto);
          setFalhou(!ok);
          if (ok) avisar(aoCopiar ?? 'Copiado.');
        }}
      >
        {rotulo}
      </button>
      {falhou && <span class="kt-muted"> Não deu para copiar sozinho: selecione o texto e use Ctrl+C.</span>}
    </>
  );
}

/** Segredo mostrado uma vez: texto selecionável + botão de copiar. */
export function CaixaChave({ rotulo, valor, children }: { rotulo: string; valor: string; children?: ComponentChildren }) {
  return (
    <div class="kt-chave">
      <div class="kt-chave-topo">
        <strong>{rotulo}</strong>
        <BotaoCopiar texto={valor} aoCopiar={`${rotulo} copiada.`} />
      </div>
      <code class="kt-chave-valor">{valor}</code>
      {children && <div class="kt-muted">{children}</div>}
    </div>
  );
}
