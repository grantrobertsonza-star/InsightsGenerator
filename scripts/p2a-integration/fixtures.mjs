import XLSX from 'xlsx';
// No disk I/O. Caller writes only after the explicit environment guard succeeds.
export function fixtures() {
  const wb=XLSX.utils.book_new();
  const sparse=XLSX.utils.aoa_to_sheet([['RespondentID','Q1'],['999',1]]);
  sparse['!ref']='A1:J101'; // declared extent only; no invented zero observations
  XLSX.utils.book_append_sheet(wb,sparse,'Sparse');
  const rows=Array.from({length:40},(_,i)=>[String(i+1).padStart(3,'0'),i%2,(i+1)%2,i%4]);
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['RespondentID','Q1',' Q1','Q1 (2)'],...rows]),'Dense');
  const unsupported=XLSX.utils.book_new();
  const ids=XLSX.utils.aoa_to_sheet([['RespondentID','AccountID','Q1'],[7,123456,0],[8,654321,1]]);
  ids.A2.z='0000';ids.A3.z='0000';ids.B2.z='#,##0';ids.B3.z='#,##0';
  XLSX.utils.book_append_sheet(unsupported,ids,'Data');
  return {
    csv:{name:'cases.csv',bytes:Buffer.from('RespondentID,Q1, Q1,Q1 (2)\n'+rows.map(r=>r.join(',')).join('\n')+'\n')},
    workbook:{name:'sparse-dense.xlsx',bytes:XLSX.write(wb,{type:'buffer',bookType:'xlsx'})},
    unsupported:{name:'unsupported-id.xlsx',bytes:XLSX.write(unsupported,{type:'buffer',bookType:'xlsx'})},
    expected:{headers:['RespondentID','Q1','Q1 (3)','Q1 (2)'],cases:40,firstId:'001',binaryCount:20,binaryPct:50}
  };
}
