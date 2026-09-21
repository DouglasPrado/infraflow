import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATALOG, LIBRARY_SECTIONS, getCatalogItem } from "./catalog.ts";

describe("catálogo", () => {
  it("não repete tipo", () => {
    const types = CATALOG.map((item) => item.type);
    assert.equal(new Set(types).size, types.length);
  });

  it("usa o formato provider.recurso em todo tipo (PRD §44)", () => {
    for (const item of CATALOG) {
      assert.match(item.type, /^(aws|opensource|onprem)\.[a-z0-9-]+$/, item.type);
      assert.equal(item.type.split(".")[0], item.provider, item.type);
    }
  });

  it("só aponta alternativa para um tipo existente (PRD §29)", () => {
    for (const item of CATALOG) {
      if (!item.alternative) continue;
      assert.ok(getCatalogItem(item.alternative), `${item.type} → ${item.alternative}`);
    }
  });

  it("nunca aponta alternativa para si mesmo", () => {
    for (const item of CATALOG) {
      assert.notEqual(item.alternative, item.type);
    }
  });

  it("só resume por chave que existe nos defaults", () => {
    for (const item of CATALOG) {
      for (const key of item.summaryKeys) {
        assert.ok(key in item.defaults, `${item.type}.${key}`);
      }
    }
  });

  it("declara toda propriedade editável nos defaults", () => {
    for (const item of CATALOG) {
      for (const field of item.properties) {
        assert.ok(field.key in item.defaults, `${item.type}.${field.key}`);
      }
    }
  });

  it("dá capacidade e custo positivos a todo recurso", () => {
    for (const item of CATALOG) {
      assert.ok(item.capacityRps > 0, item.type);
      assert.ok(item.monthlyCostUsd > 0, item.type);
    }
  });

  it("cobre toda seção da library com pelo menos um recurso", () => {
    for (const section of LIBRARY_SECTIONS) {
      if (section.category === "testing") continue;
      assert.ok(
        CATALOG.some((item) => item.category === section.category),
        section.label,
      );
    }
  });
});
