import { useState } from 'preact/hooks';
import { Aviso, Carregando, Vazio } from '../../comum/componentes';
import { Icone } from '../../comum/icones';
import { dinheiro, inteiro, percentual } from '../../comum/formato';
import type { Carga } from './filtro';
import { SituacaoCarga } from './visao-geral';
import type { Criativos as Dados } from './tipos';

/** Miniatura com reserva: se a imagem não carregar, mostra as iniciais do anúncio. */
function Miniatura({ url, nome }: { url: string | null; nome: string }) {
  const [falhou, setFalhou] = useState(false);
  const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  if (!url || falhou) return <div class="kt-miniatura kt-miniatura-vazia" aria-hidden="true">{iniciais}</div>;
  return <img class="kt-miniatura" src={url} alt="" loading="lazy" onError={() => setFalhou(true)} />;
}

export function Criativos({ carga }: { carga: Carga<Dados> }) {
  const { dados, erro, carregando } = carga;
  if (!dados) return erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />;
  return (
    <div class={carregando ? 'kt-recarregando' : ''}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <SituacaoCarga cargaPendente={dados.cargaPendente} sincronizadoEm={dados.sincronizadoEm} />
      {dados.criativos.length === 0 ? (
        <section class="kt-card">
          <Vazio icone="imagem" titulo="Nenhum anúncio com entrega no período">
            Troque o período ou a conta de anúncio no filtro.
          </Vazio>
        </section>
      ) : (
        <>
          <p class="kt-muted kt-nota">
            <Icone nome="info" tamanho={14} /> Os anúncios que mais investiram no período, até 60.
          </p>
          <div class="kt-criativos">
            {dados.criativos.map((c, posicao) => (
              <article key={c.idMeta} class="kt-criativo">
                <div class="kt-criativo-imagem">
                  <Miniatura url={c.miniatura} nome={c.nome} />
                  <span class="kt-criativo-posicao">#{posicao + 1}</span>
                  {c.status && c.status !== 'ACTIVE' && <span class="kt-criativo-status">Pausado</span>}
                </div>
                <div class="kt-criativo-corpo">
                  <h3 title={c.nome}>{c.nome}</h3>
                  {c.campanha && (
                    <p class="kt-muted kt-uma-linha" title={c.campanha}>
                      <Icone nome="megafone" tamanho={12} /> {c.campanha}
                    </p>
                  )}
                  {c.titulo && <p class="kt-uma-linha kt-criativo-titulo" title={c.titulo}>“{c.titulo}”</p>}
                  <dl class="kt-criativo-metricas">
                    <div>
                      <dt>Investimento</dt>
                      <dd>{dinheiro(c.metricas.investimento, dados.moeda)}</dd>
                    </div>
                    <div>
                      <dt>Leads</dt>
                      <dd>{inteiro(c.metricas.leads)}</dd>
                    </div>
                    <div>
                      <dt>CPL</dt>
                      <dd>{dinheiro(c.metricas.cpl, dados.moeda)}</dd>
                    </div>
                    <div>
                      <dt>CTR</dt>
                      <dd>{percentual(c.metricas.ctr)}</dd>
                    </div>
                    <div>
                      <dt>Vendas</dt>
                      <dd>{inteiro(c.metricas.vendas)}</dd>
                    </div>
                    <div>
                      <dt>Custo/venda</dt>
                      <dd>{dinheiro(c.metricas.custoPorVenda, dados.moeda)}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
