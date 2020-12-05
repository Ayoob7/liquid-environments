import os
import numpy as np
files = [f for f in os.listdir('.') if os.path.isfile(f) and '.obj' in f]
size_dic = {file: os.stat(file).st_size for file in files}
sort_array = sorted(size_dic.items(), key=lambda x: x[1])
sizes = [x[1] for x in sort_array]
npa = np.asarray(sizes, dtype=np.int32)
percentile_95_8 = np.percentile(npa,95.8)
new_dict = {key:val for key,val in sort_array if val > percentile_95_8}
del_files = [os.remove(file) for file in files if file not in new_dict.keys()]
f = open("dir_details.txt","a")
f.truncate(0)
string_literal = "'"+','.join(list(new_dict.keys()))+"'"
f.write(string_literal)
f.close()