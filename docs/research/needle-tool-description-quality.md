# Needle tool-description length and quality

- **Status:** Research note; evaluation pending
- **Owner:** Couchview maintainers
- **Last verified:** 2026-08-22
- **Superseded by:** —

Researched 2026-08-15 against Needle repository commit
[`c152cc4`](https://github.com/cactus-compute/needle/tree/c152cc4d9821a002285f85aaf58876c6d60541fe).

## Answer

Needle has no published description-length recommendation, hard per-description limit, or
short-versus-long quality benchmark. The official sources do not establish that longer descriptions
are better, and they do not establish that length alone reduces quality.

For Couchview, start with one compact, distinctive description per voice action. State the effect,
include important domain synonyms naturally, and add a short boundary only when two actions are easy
to confuse. Do not put a list of example utterances into every description initially. Keep those
utterances in the evaluation corpus, then add a phrase to a description only when an A/B test shows a
retrieval or selection miss.

This is an engineering recommendation inferred from Needle's documented retrieval design. It is not
a Needle requirement.

## Direct Needle evidence

### Descriptions are model input

Needle says that it uses tool descriptions for both tool choice and argument filling. Its official
examples use short functional sentences, but it does not compare those examples with longer variants.
[Needle README](https://github.com/cactus-compute/needle/blob/c152cc4d9821a002285f85aaf58876c6d60541fe/README.md#L27-L48)

In a raw schema, `description` is a string. With the Python decorator, Needle joins all docstring lines
before the `Args:` section into one string; argument documentation becomes each property's description.
The Python schema builder and wrapper do not impose a description-length check.
[API examples](https://github.com/cactus-compute/needle/blob/c152cc4d9821a002285f85aaf58876c6d60541fe/doc/apis.md#L13-L68),
[schema builder](https://github.com/cactus-compute/needle/blob/c152cc4d9821a002285f85aaf58876c6d60541fe/needle/agent/tools.py#L94-L140),
[runtime wrapper](https://github.com/cactus-compute/needle/blob/c152cc4d9821a002285f85aaf58876c6d60541fe/needle/__init__.py#L53-L101)

An earlier first-party change that introduced descriptions states that the encoder tokenizes the full
tools JSON and that descriptions were added for better semantic matching. This describes the original
integration, not a length ablation for Needle 2.
[Needle pull request 21](https://github.com/cactus-compute/needle/pull/21)

### More than five tools creates a retrieval gate

When a catalogue contains more than five tools, Needle embeds each complete tool schema and embeds the
query. Only the five highest-scoring schemas enter the model context, and an omitted tool cannot be
called. Changing a schema causes its cached embedding to be rebuilt.
[Needle API: tool retrieval](https://github.com/cactus-compute/needle/blob/c152cc4d9821a002285f85aaf58876c6d60541fe/doc/apis.md#L145-L153)

Therefore, a Couchview description influences two decisions:

1. Whether the action survives top-five retrieval.
2. Whether the model selects it from the retrieved tools and fills its arguments correctly.

For a stacked request, every required action must survive the same top-five gate. This consequence
follows directly from the documented gate, but Needle does not publish a stacked-command retrieval
benchmark.

### Context and token limits do not define a description limit

Needle documents a 256-token sliding conversation window and keeps tools pinned as KV sinks. It does
not document a separate maximum for a tool description or explain whether the native retriever
truncates an unusually long schema.
[Needle README](https://github.com/cactus-compute/needle/blob/c152cc4d9821a002285f85aaf58876c6d60541fe/README.md#L9-L15)

The fine-tuning command has a separate default limit of 1,024 tokens per rendered training example,
and longer training examples are silently truncated. That limit applies to fine-tuning examples; it
must not be presented as the runtime description limit.
[Needle fine-tuning guide](https://github.com/cactus-compute/needle/blob/c152cc4d9821a002285f85aaf58876c6d60541fe/doc/finetuning.md#L13-L19)

### Similar tools need targeted evaluation data

The official fine-tuning guide says that a catalogue with similar tools should include ambiguous
queries labelled with the correct tool. It also says varied phrasing belongs in the training data.
[Needle fine-tuning guide](https://github.com/cactus-compute/needle/blob/c152cc4d9821a002285f85aaf58876c6d60541fe/doc/finetuning.md#L13-L19),
[data-generation prompt](https://github.com/cactus-compute/needle/blob/c152cc4d9821a002285f85aaf58876c6d60541fe/needle/model/finetune.py#L31-L53)

The official 12-tool playground preset also uses terse descriptions such as `Control lights.` and
`Set temperature.` This is evidence of Cactus's example style, not comparative proof that terse text
is more accurate.
[Needle playground presets](https://github.com/cactus-compute/needle/blob/c152cc4d9821a002285f85aaf58876c6d60541fe/needle/playground/app.js#L1-L2)

### The paper does not answer this question

The linked Simple Attention Network paper evaluates the model architecture. It does not report an
ablation for tool-description wording, description length, examples in descriptions, overlapping
tools, or top-five tool-retrieval quality.
[A Controlled Study of Attention-Only Transformers](https://arxiv.org/abs/2607.18363)

The Cactus engineering post also characterizes small models as sensitive to the application and asks
teams to test their own tools. It supplies no description-length result.
[Cactus Needle engineering post](https://cactuscompute.com/blog/needle)

## What is inference, not documented fact

- Useful, distinctive terms can help because the retriever embeds the full schema.
- Repeated boilerplate and long phrase lists can make related schemas share more vocabulary and can
  reduce their semantic separation.
- Longer selected schemas require more input processing and keep more tool text in pinned context.
- None of these points proves that a particular word count changes Needle accuracy. They are reasons
  to measure compact and expanded schema variants on the real catalogue.

## Recommended Couchview starting schema

```json
{
  "name": "open_package_commands",
  "description": "Open the package-command panel that lists package scripts or npm commands. Does not run a command.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

Use these conventions for the first version:

- Give each action a meaningful, distinct name.
- Use one short sentence for the observable effect.
- Add important synonyms as normal prose, not as a quoted phrase catalogue.
- Add one boundary sentence only for a likely confusion, such as opening package commands versus
  running one.
- Put argument meaning in parameter descriptions rather than the tool description.
- Treat roughly 10–25 words as a Couchview starting style target, not a Needle limit.

## Evaluation needed before accepting the 19-tool catalogue

Compare at least these description variants with the same held-out utterances:

1. Compact effect-only descriptions.
2. Compact descriptions plus domain synonyms and confusion boundaries.
3. Longer descriptions containing two or three example utterances.

Measure:

- exact registered phrases;
- common paraphrases;
- negative and off-topic requests;
- confusing pairs such as `open_review` versus `mark_current_file_reviewed`;
- stacked pairs and triples;
- complete ordered-call accuracy, not only the first correct call;
- confidence, empty-call rate, and the action confusion matrix.

If the runtime does not expose its retrieved candidates, compare the same query against the complete
19-tool catalogue and a hand-selected five-tool subset. A success with the subset and failure with the
complete catalogue is evidence of a retrieval-stage problem, although it does not expose the exact
ranking.

## Bottom line for the plan

Proceed with separate tools, but do not make every description long by default. Use compact,
discriminative descriptions first and treat example-rich descriptions as an evaluation variant. The
five-tool retrieval gate, especially for stacked commands, is the principal Needle-specific risk to
test.
