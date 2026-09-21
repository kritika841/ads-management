import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanScriptText(text, html) {
  let cleaned = (text || '').trim();
  if (!cleaned && html) {
    cleaned = stripHtml(html);
  } else if (cleaned.includes('<p>') || cleaned.includes('<br>') || cleaned.includes('<div>')) {
    cleaned = stripHtml(cleaned);
  }
  return cleaned
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+\n/g, '\n\n')
    .trim();
}

function extractHook(scriptText) {
  if (!scriptText) return '';
  const lines = scriptText.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  // Take first 1 or 2 meaningful lines or sentences
  const firstLine = lines[0];
  if (firstLine.length < 50 && lines.length > 1) {
    return `${firstLine} ${lines[1]}`.trim();
  }
  return firstLine;
}

async function main() {
  console.log('Fetching creative library scripts and metadata from Supabase...');

  const [
    { data: ads, error: adsError },
    { data: campaigns, error: campaignsError },
    { data: products, error: productsError },
    { data: profiles, error: profilesError },
    { data: adTags, error: adTagsError },
    { data: tags, error: tagsError }
  ] = await Promise.all([
    supabase
      .from('ads')
      .select(`
        id,
        name,
        campaign_id,
        product_id,
        creator_id,
        editor_id,
        status,
        production_stage,
        ad_type,
        platforms,
        script_text,
        script_html,
        drive_url,
        preview_url,
        thumbnail_url,
        notes,
        created_at,
        submitted_at,
        approved_at
      `)
      .order('name', { ascending: true }),
    supabase.from('campaigns').select('id, name'),
    supabase.from('products').select('id, name'),
    supabase.from('profiles').select('id, name, email, role'),
    supabase.from('ad_tags').select('ad_id, tag_id'),
    supabase.from('tags').select('id, name')
  ]);

  if (adsError) throw adsError;
  if (campaignsError) throw campaignsError;
  if (productsError) throw productsError;
  if (profilesError) throw profilesError;
  if (adTagsError) throw adTagsError;
  if (tagsError) throw tagsError;

  const campaignMap = new Map((campaigns || []).map(c => [c.id, c.name]));
  const productMap = new Map((products || []).map(p => [p.id, p.name]));
  const profileMap = new Map((profiles || []).map(p => [p.id, p.name]));
  const tagMap = new Map((tags || []).map(t => [t.id, t.name]));

  const adTagsMap = new Map();
  for (const at of adTags || []) {
    const tagName = tagMap.get(at.tag_id);
    if (!tagName) continue;
    if (!adTagsMap.has(at.ad_id)) adTagsMap.set(at.ad_id, []);
    adTagsMap.get(at.ad_id).push(tagName);
  }

  const expandedList = [];
  let withScriptCount = 0;
  let emptyScriptCount = 0;

  for (const ad of ads || []) {
    const script = cleanScriptText(ad.script_text, ad.script_html);
    const hasScript = Boolean(script && script.length > 5);
    if (hasScript) withScriptCount++;
    else emptyScriptCount++;

    const wordCount = script ? script.split(/\s+/).filter(Boolean).length : 0;
    const hook = extractHook(script);

    const record = {
      ad_id: ad.id,
      creative_code: ad.name,
      product: productMap.get(ad.product_id) || 'Unassigned',
      campaign: campaignMap.get(ad.campaign_id) || 'Unassigned',
      creator: profileMap.get(ad.creator_id) || 'Unassigned',
      editor: profileMap.get(ad.editor_id) || 'Unassigned',
      production_stage: ad.production_stage || ad.status || 'unknown',
      ad_type: ad.ad_type || 'video',
      platforms: Array.isArray(ad.platforms) ? ad.platforms : [],
      tags: adTagsMap.get(ad.id) || [],
      hook: hook,
      script_text: script,
      word_count: wordCount,
      has_script: hasScript,
      drive_url: ad.drive_url || null,
      preview_url: ad.preview_url || null,
      created_at: ad.created_at
    };

    expandedList.push(record);
  }

  // Ensure data directory exists
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 1. Write JSON
  const jsonPath = path.join(dataDir, 'creative-library-scripts-expanded.json');
  fs.writeFileSync(jsonPath, JSON.stringify(expandedList, null, 2), 'utf8');
  console.log(`Saved JSON: ${jsonPath} (${expandedList.length} items, ${withScriptCount} with scripts)`);

  // 2. Write Markdown
  const mdPath = path.join(dataDir, 'creative-library-scripts-expanded.md');
  const mdHeader = [
    '# Creative Library Ad Scripts Catalog (Expanded Format)',
    `Generated on: ${new Date().toISOString()}`,
    `Total Creatives: ${expandedList.length}`,
    `Creatives with Scripts: ${withScriptCount}`,
    `Creatives missing Scripts: ${emptyScriptCount}`,
    '',
    '---',
    ''
  ].join('\n');

  // Group by Product for clear markdown navigation
  const byProduct = new Map();
  for (const item of expandedList) {
    const prod = item.product;
    if (!byProduct.has(prod)) byProduct.set(prod, []);
    byProduct.get(prod).push(item);
  }

  let mdContent = mdHeader;
  for (const [prod, items] of byProduct.entries()) {
    mdContent += `## Product: ${prod} (${items.length} creatives)\n\n`;
    for (const ad of items) {
      mdContent += `### Creative: ${ad.creative_code} (${ad.ad_id})\n`;
      mdContent += `- **Campaign**: ${ad.campaign}\n`;
      mdContent += `- **Creator**: ${ad.creator} | **Editor**: ${ad.editor}\n`;
      mdContent += `- **Stage**: ${ad.production_stage} | **Type**: ${ad.ad_type}\n`;
      if (ad.tags.length) {
        mdContent += `- **Tags**: ${ad.tags.join(', ')}\n`;
      }
      if (ad.hook) {
        mdContent += `- **Hook**: "${ad.hook.replace(/\n/g, ' ')}"\n`;
      }
      mdContent += `- **Word Count**: ${ad.word_count}\n`;
      mdContent += `\n**Full Script**:\n\`\`\`\n${ad.script_text || '[No Script Recorded]'}\n\`\`\`\n\n---\n\n`;
    }
  }

  fs.writeFileSync(mdPath, mdContent, 'utf8');
  console.log(`Saved Markdown: ${mdPath}`);

  console.log('\nSummary:');
  console.log(`- Total Creatives Processed: ${expandedList.length}`);
  console.log(`- Creatives with Full Script: ${withScriptCount}`);
  console.log(`- Creatives with Missing Script: ${emptyScriptCount}`);
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
