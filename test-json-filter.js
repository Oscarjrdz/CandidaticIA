import dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });
import { searchCandidateRoster } from './api/utils/copilot-candidate-knowledge.js';

async function test() {
    try {
        console.log("Probando Traductor JSON Flash...");
        
        // Simular un roster básico
        const mockRoster = [
            { nombre: "Ana", genero: "femenino", edad: 20 },
            { nombre: "Maria", genero: "femenino", edad: 24 },
            { nombre: "Luis", genero: "masculino", edad: 20 },
            { nombre: "Sofia", genero: "femenino", edad: 28 },
            { nombre: "Carlos", genero: "masculino", edad: 35 }
        ];

        // Prueba 1: Rango de edad y género
        const query1 = "cuantas mujeres de 20 a 25 años hay";
        const result1 = await searchCandidateRoster(mockRoster, query1);
        console.log(`\nQuery: "${query1}" => Encontrados: ${result1.totalMatches} (esperado 2: Ana, Maria)`);

        // Prueba 2: Historial Cruzado
        const query2 = "cuantas mujeres hay. y de 28";
        const result2 = await searchCandidateRoster(mockRoster, query2);
        console.log(`\nQuery: "${query2}" => Encontrados: ${result2.totalMatches} (esperado 1: Sofia)`);

    } catch(e) {
        console.error("Error:", e);
    }
    process.exit(0);
}
test();
