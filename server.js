// Dependências: npm install express multer xml2js json2csv fs

const express = require("express");
const multer = require("multer");
const xml2js = require("xml2js");
const { Parser } = require("json2csv");
const fs = require("fs");
const path = require("path");

const app = express();
const upload = multer({ dest: "uploads/" });
const port = 3000;

// Função que extrai dados do XML convertido para JSON
function extractCSVData(json) {
  try {
    const report =
      json["GalgoAssBalStmt"]["BsnsMsg"][0]["ns3:Document"][0][
        "ns3:SctiesBalAcctgRpt"
      ][0];
    const generalDetails = report["ns3:StmtGnlDtls"][0];
    const positions = report["ns3:BalForAcct"];

    const rows = positions.map((position) => {
      const finId = position["ns3:FinInstrmId"][0];
      let quantidade_cotas =
        position["ns3:AggtBal"]?.[0]?.["ns3:Qty"]?.[0]?.["ns3:Qty"]?.[0]?.[
          "ns3:Unit"
        ]?.[0] || 0;
      const valor_cota =
        position["ns3:PricDtls"]?.find(
          (p) => p["ns3:Tp"]?.[0]?.["ns3:Cd"]?.[0] === "NAVL"
        )?.["ns3:Val"]?.[0]?.["ns3:Amt"]?.[0]?._ || 0;
      let valor_total_ativos =
        position["ns3:AcctBaseCcyAmts"]?.[0]?.["ns3:HldgVal"]?.[0]?.[
          "ns3:Amt"
        ]?.[0]?._ || 0;

      // Calculate valor_total_ativos if not present or incorrect
      if (!valor_total_ativos && quantidade_cotas && valor_cota) {
        valor_total_ativos =
          parseFloat(quantidade_cotas) * parseFloat(valor_cota);
      }

      const patrimonio_liquido =
        report["ns3:AcctBaseCcyTtlAmts"]?.[0]?.["ns3:TtlHldgsValOfStmt"]?.[0]?.[
          "ns3:Amt"
        ]?.[0]?._ || 0;

      // Extract CNPJ (carefully, as it might not always be directly under FinInstrmId)
      let cnpj = "";
      if (finId["ns3:OthrId"]) {
        const cnpjObj = finId["ns3:OthrId"].find(
          (o) =>
            o["ns3:Tp"]?.[0]?.["ns3:Prtry"]?.[0] === "CNPJCLASSE" ||
            o["ns3:Tp"]?.[0]?.["ns3:Prtry"]?.[0] === "CNPJ"
        );
        if (cnpjObj) {
          cnpj = cnpjObj["ns3:Id"]?.[0] || "";
        }
      }

      // Handle CASH and REAL (Imoveis) - quantity should be 1
      if (
        finId["ns3:OthrId"]?.some(
          (o) => o["ns3:Id"]?.[0] === "CASH" || o["ns3:Id"]?.[0] === "REAL"
        )
      ) {
        quantidade_cotas = 1;
      }

      return {
        identificador_arquivo: generalDetails["ns3:StmtId"]?.[0] || "",
        data_arquivo:
          generalDetails["ns3:StmtDtTm"]?.[0]?.["ns3:Dt"]?.[0] || "",
        nome_fundo: finId["ns3:Desc"]?.[0] || "",
        isin: finId["ns3:ISIN"]?.[0] || "",
        cnpj: cnpj,
        quantidade_cotas: quantidade_cotas,
        valor_cota: valor_cota,
        valor_total_ativos: valor_total_ativos,
        patrimonio_liquido: patrimonio_liquido,
      };
    });

    return rows;
  } catch (err) {
    console.error("Erro ao extrair dados:", err);
    return [];
  }
}

app.post("/upload", upload.single("file"), (req, res) => {
  const xmlPath = req.file.path;

  fs.readFile(xmlPath, "utf8", (err, xmlData) => {
    if (err) return res.status(500).send("Erro ao ler o arquivo XML");

    xml2js.parseString(
      xmlData,
      { explicitArray: true, ignoreAttributes: false, charsAsArray: false },
      (err, jsonData) => {
        // Added options for better parsing
        if (err) return res.status(500).send("Erro ao converter XML para JSON");

        const data = extractCSVData(jsonData);
        const json2csvParser = new Parser();
        const csv = json2csvParser.parse(data);

        const outputPath = path.join(__dirname, "output.csv");
        fs.writeFileSync(outputPath, csv);

        res.download(outputPath, "convertido.csv", () => {
          fs.unlinkSync(outputPath);
          fs.unlinkSync(xmlPath);
        });
      }
    );
  });
});

app.listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`);
});
