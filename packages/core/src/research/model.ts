import { z } from 'zod';

/** A niche the model proposed; its judgments are evidence, not decisions. */
export const Candidate = z.object({
  niche: z
    .string()
    .describe('Short name of the niche, e.g. "semester planners for college students"'),
  keywords: z
    .array(z.string())
    .describe('2–3 phrases a buyer would type into Etsy search, lowercase'),
  rationale: z.string().describe('One or two sentences on why it could sell as a digital download'),
  codeFriendliness: z
    .number()
    .int()
    .describe(
      '1–5: how well it can be built as HTML/CSS → PDF (tables, grids, typography) without illustration',
    ),
  variantPotential: z
    .number()
    .int()
    .describe(
      '1–5: how many distinct listings one template can become (sizes, years, themes, digital vs printable)',
    ),
});
export type Candidate = z.infer<typeof Candidate>;
export const Candidates = z.object({ candidates: z.array(Candidate) });

export const Idea = z.object({
  name: z.string(),
  buyer: z.string().describe('Who buys it and when'),
  pages: z.string().describe('What the PDF contains, page by page or section by section'),
  variants: z.array(z.string()).describe('Variants that could be separate listings or options'),
  whyItSells: z.string(),
});
export type Idea = z.infer<typeof Idea>;
export const Ideas = z.object({ ideas: z.array(Idea) });

/** One search result the owner recorded from Etsy. */
export interface ListingObs {
  keyword: string;
  rank: number;
  price: number | null;
  reviews: number | null;
  bestseller: boolean;
  digital: boolean;
}

export interface KeywordObs {
  keyword: string;
  results: number | null;
}
