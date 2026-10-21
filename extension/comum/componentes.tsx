import { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { copiar } from './copiar';
import { Icone, NomeIcone } from './icones';
import { avisar } from './omni';

const ICONE_AVISO = { info: 'info', erro: 'alerta', ok: 'check' } as const;

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'erro' | 'ok'; children: ComponentChildren }) {
  return (
    <div class={`kt-aviso kt-aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      <Icone nome={ICONE_AVISO[tipo]} tamanho={18} classe="kt-aviso-icone" />
      <div>{children}</div>
    </div>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <p class="kt-carregando">
      <span class="kt-girando" aria-hidden="true" />
      {texto}
    </p>
  );
}

/** Estado vazio: ícone, título curto e o que fazer. */
export function Vazio({ icone, titulo, children }: { icone: NomeIcone; titulo: string; children?: ComponentChildren }) {
  return (
    <div class="kt-vazio">
      <span class="kt-vazio-icone">
        <Icone nome={icone} tamanho={22} />
      </span>
      <strong>{titulo}</strong>
      {children && <div class="kt-muted">{children}</div>}
    </div>
  );
}

/** Cartão de seção com cabeçalho (ícone, título, descrição e ações à direita). */
export function Secao({
  icone,
  titulo,
  descricao,
  acoes,
  children,
  classe,
}: {
  icone?: NomeIcone;
  titulo: string;
  descricao?: ComponentChildren;
  acoes?: ComponentChildren;
  children?: ComponentChildren;
  classe?: string;
}) {
  return (
    <section class={`kt-card${classe ? ` ${classe}` : ''}`}>
      <header class="kt-card-topo">
        {icone && (
          <span class="kt-card-icone">
            <Icone nome={icone} tamanho={18} />
          </span>
        )}
        <div class="kt-card-titulos">
          <h2>{titulo}</h2>
          {descricao && <p class="kt-muted">{descricao}</p>}
        </div>
        {acoes && <div class="kt-card-acoes">{acoes}</div>}
      </header>
      {children}
    </section>
  );
}

/** Iniciais num círculo: identifica pessoas e anúncios sem foto. */
export function Avatar({ nome, tamanho = 28 }: { nome: string | null | undefined; tamanho?: number }) {
  const iniciais =
    (nome ?? '')
      .split(/\s+/)
      .filter((p) => /[\p{L}\d]/u.test(p))
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?';
  return (
    <span class="kt-avatar" style={{ width: `${tamanho}px`, height: `${tamanho}px`, fontSize: `${Math.round(tamanho * 0.4)}px` }} aria-hidden="true">
      {iniciais}
    </span>
  );
}

/** Interruptor liga/desliga (checkbox por baixo, para teclado e leitores de tela). */
export function Interruptor({ ligado, mudar, children }: { ligado: boolean; mudar: (v: boolean) => void; children: ComponentChildren }) {
  return (
    <label class="kt-interruptor">
      <input type="checkbox" role="switch" checked={ligado} onChange={(e) => mudar((e.target as HTMLInputElement).checked)} />
      <span class="kt-interruptor-trilho" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

export function BotaoCopiar({ texto, rotulo = 'Copiar', aoCopiar }: { texto: string; rotulo?: string; aoCopiar?: string }) {
  const [estado, setEstado] = useState<'parado' | 'ok' | 'falhou'>('parado');
  return (
    <>
      <button
        type="button"
        class="kt-botao kt-botao-secundario kt-botao-pequeno"
        onClick={async () => {
          const ok = await copiar(texto);
          setEstado(ok ? 'ok' : 'falhou');
          if (ok) {
            avisar(aoCopiar ?? 'Copiado.');
            setTimeout(() => setEstado('parado'), 1800);
          }
        }}
      >
        <Icone nome={estado === 'ok' ? 'check' : 'copiar'} tamanho={14} />
        {estado === 'ok' ? 'Copiado' : rotulo}
      </button>
      {estado === 'falhou' && <span class="kt-muted"> Não deu para copiar sozinho: selecione o texto e use Ctrl+C.</span>}
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
