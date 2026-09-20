import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  block,
  bool,
  interpolated,
  list,
  num,
  obj,
  printFile,
  ref,
  resource,
  str,
  variable,
} from "./index.ts";

const printed = (blocks: Parameters<typeof printFile>[0]["blocks"]) =>
  printFile({ name: "t.tf", blocks });

describe("formato canônico", () => {
  it("alinha o `=` de atributos consecutivos de uma linha", () => {
    const output = printed([
      resource("aws_lb", "public", [
        ["name", str("x")],
        ["internal", bool(false)],
        ["load_balancer_type", str("application")],
      ]),
    ]);

    assert.equal(
      output,
      `resource "aws_lb" "public" {
  name               = "x"
  internal           = false
  load_balancer_type = "application"
}
`,
    );
  });

  it("tira do alinhamento o atributo de várias linhas e o que vem depois", () => {
    const output = printed([
      resource("x", "y", [
        ["a", num(1)],
        ["bbbbbb", num(2)],
        ["tags", obj([["Name", str("x")], ["Environment", str("dev")]])],
        ["port", num(5432)],
      ]),
    ]);

    assert.match(output, /^ {2}a {6}= 1$/m);
    assert.match(output, /^ {2}tags = \{$/m);
    assert.match(output, /^ {4}Name {8}= "x"$/m);
    assert.match(output, /^ {2}port = 5432$/m);
  });

  it("mantém lista curta em linha e quebra a longa", () => {
    const short = printed([resource("x", "y", [["ids", list([num(1), num(2)])]])]);
    assert.match(short, /^ {2}ids = \[1, 2\]$/m);

    const long = printed([
      resource("x", "y", [
        ["ids", list([ref("aws_subnet.muito_longo_um.id"), ref("aws_subnet.muito_longo_dois.id")])],
      ]),
    ]);
    assert.match(long, /^ {2}ids = \[$/m);
    assert.match(long, /^ {4}aws_subnet\.muito_longo_um\.id,$/m);
  });

  it("indenta bloco aninhado e o separa do que veio antes", () => {
    const output = printed([
      resource("aws_lb_listener", "http", [["port", num(80)]], [
        block("default_action", [], [["type", str("forward")]]),
      ]),
    ]);

    assert.equal(
      output,
      `resource "aws_lb_listener" "http" {
  port = 80

  default_action {
    type = "forward"
  }
}
`,
    );
  });

  it("respeita a indentação relativa de uma expressão de várias linhas", () => {
    const output = printed([
      resource("x", "y", [["policy", ref('jsonencode({\n  Version = "2012-10-17"\n})')]]),
    ]);

    assert.equal(
      output,
      `resource "x" "y" {
  policy = jsonencode({
    Version = "2012-10-17"
  })
}
`,
    );
  });
});

describe("segurança do literal", () => {
  it("escapa aspas e interpolação vinda do canvas", () => {
    const output = printed([
      resource("x", "y", [["name", str('nome "com" ${var.secret} aspas')]]),
    ]);

    assert.match(output, /\\"com\\"/);
    // `${` dentro de literal vira `$${`: nome digitado no canvas não vira código.
    assert.match(output, /\$\$\{var\.secret\}/);
  });

  it("interpolação declarada como expressão passa intacta", () => {
    const output = printed([resource("x", "y", [["name", interpolated("${var.project}-api")]])]);
    assert.match(output, /name = "\$\{var\.project\}-api"/);
  });
});

describe("arquivo", () => {
  it("escreve cabeçalho como comentário e separa blocos por linha em branco", () => {
    const output = printFile({
      name: "variables.tf",
      header: ["Gerado pelo InfraFlow."],
      blocks: [
        variable("region", [["type", ref("string")]]),
        variable("project", [["type", ref("string")]]),
      ],
    });

    assert.equal(
      output,
      `# Gerado pelo InfraFlow.

variable "region" {
  type = string
}

variable "project" {
  type = string
}
`,
    );
  });
});
