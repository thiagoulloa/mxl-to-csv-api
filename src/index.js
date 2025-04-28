const express = require("express");
const multer = require("multer");
const xml2js = require("xml2js");
const { Parser } = require("json2csv");
const fs = require("fs");
const path = require("path");

const app = express();
// Use memory storage para evitar escrever diretamente no sistema de arquivos
const upload = multer({ storage: multer.memoryStorage() });
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
  const xmlData = req.file.buffer.toString(); // Get XML data from buffer

  xml2js.parseString(
    xmlData,
    { explicitArray: true, ignoreAttributes: false, charsAsArray: false },
    (err, jsonData) => {
      if (err) {
        console.error("Erro ao converter XML para JSON:", err);
        return res.status(500).send("Erro ao converter XML para JSON");
      }

      const data = extractCSVData(jsonData);
      const json2csvParser = new Parser();
      const csv = json2csvParser.parse(data);

      // Use /tmp for the output file
      const tmpPath = path.join("/tmp", "output.csv");
      fs.writeFileSync(tmpPath, csv);

      // Set the content-disposition header to prompt download
      res.setHeader(
        "Content-disposition",
        "attachment; filename=convertido.csv"
      );
      res.set("Content-Type", "text/csv"); //set the correct content type

      // Stream the file directly to the response
      const fileStream = fs.createReadStream(tmpPath);
      fileStream.pipe(res);

      // Clean up the temporary file after it has been sent
      fileStream.on("end", () => {
        fs.unlinkSync(tmpPath);
      });

      fileStream.on("error", (error) => {
        console.error("Error streaming file:", error);
        res.status(500).send("Error streaming file");
        fs.unlinkSync(tmpPath); //cleanup
      });
    }
  );
});

app.get("/", (req, res) => {
  res.send("Olá");
});

app.listen(port, () => {
  console.log(`API rodando em http://localhost:${port}`);
});
